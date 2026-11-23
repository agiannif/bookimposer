//! Carries each source page's transparency group (/Group) onto the form
//! XObject that holds that page's content in the exported PDF. PDFium's
//! page-to-form copy leaves the /Group behind, and a page group can change
//! how transparent content blends, so it is added afterwards with lopdf.

use crate::ExportError;
use crate::layout::Layout;
use lopdf::{Document, Object, ObjectId};
use std::collections::HashMap;

/// What [`carry_page_groups`] did.
#[derive(Debug, PartialEq)]
pub enum Carried {
    /// No placed page has a /Group, so the output is left as it was.
    Unchanged,
    /// The groups were added to the output.
    Added,
    /// lopdf could not read the source (PDFium, which repairs more, could);
    /// holds lopdf's error. The output is left as it was.
    SourceUnreadable(String),
}

/// Sets every placed page's /Group on that placement's page-content form in
/// `output`, PDFium's export of `layout` from the PDF in `source`.
///
/// Forms are matched to placements by structure, not by content: output page
/// 2i is sheet i's front and 2i+1 its back, and each draws one wrapper form
/// per non-blank placement with a `Do`, in placement order (`embed::place`
/// adds them in that order). Each wrapper is the clip page and holds exactly
/// one form, the copy of the source page whose content is the page's own.
/// Matching by content instead would be ambiguous for identical pages.
pub fn carry_page_groups(
    source: &[u8],
    output: &mut Document,
    layout: &Layout,
) -> Result<Carried, ExportError> {
    let source = match Document::load_mem(source) {
        Ok(source) => source,
        Err(error) => return Ok(Carried::SourceUnreadable(error.to_string())),
    };
    let source = &source;
    let source_pages = source.get_pages();
    let group_of = |pdf_page: usize| {
        let page = source_pages.get(&(pdf_page as u32 + 1))?;
        source.get_dictionary(*page).ok()?.get(b"Group").ok()
    };
    let sides = || layout.sheets.iter().flat_map(|s| [&s.front, &s.back]);
    let wanted = sides()
        .flat_map(|side| &side.placements)
        .filter_map(|placement| placement.pdf_page)
        .any(|pdf_page| group_of(pdf_page).is_some());
    if !wanted {
        return Ok(Carried::Unchanged);
    }

    let output_pages = output.get_pages();
    let mut copied = HashMap::new();
    for (index, side) in sides().enumerate() {
        let page = *output_pages
            .get(&(index as u32 + 1))
            .ok_or_else(|| unexpected(format!("no output page {}", index + 1)))?;
        let wrappers = drawn_forms(output, page)?;
        let placed: Vec<usize> = side.placements.iter().filter_map(|p| p.pdf_page).collect();
        if wrappers.len() != placed.len() {
            return Err(unexpected(format!(
                "output page {} draws {} forms for {} placements",
                index + 1,
                wrappers.len(),
                placed.len()
            )));
        }
        for (wrapper, pdf_page) in wrappers.into_iter().zip(placed) {
            let Some(group) = group_of(pdf_page) else {
                continue;
            };
            let group = deep_copy(source, output, group, &mut copied)?;
            let form = only_form_in(output, wrapper)?;
            output
                .get_object_mut(form)
                .and_then(Object::as_stream_mut)
                .map_err(rewrite_error)?
                .dict
                .set("Group", group);
        }
    }
    Ok(Carried::Added)
}

/// The forms `page`'s content draws with `Do`, in drawing order.
fn drawn_forms(doc: &Document, page: ObjectId) -> Result<Vec<ObjectId>, ExportError> {
    // PDFium writes each sheet page's own /Resources; nothing is inherited.
    let xobjects = doc
        .get_dictionary(page)
        .and_then(|page| page.get(b"Resources"))
        .and_then(|r| doc.dereference(r))
        .and_then(|(_, r)| r.as_dict())
        .ok()
        .and_then(|r| r.get(b"XObject").ok())
        .map(|x| doc.dereference(x).and_then(|(_, x)| x.as_dict()))
        .transpose()
        .map_err(rewrite_error)?;
    let content = doc
        .get_and_decode_page_content(page)
        .map_err(rewrite_error)?;
    content
        .operations
        .iter()
        .filter(|op| op.operator == "Do")
        .map(|op| {
            let name = op.operands.first().and_then(|n| n.as_name().ok());
            name.and_then(|name| xobjects?.get(name).ok()?.as_reference().ok())
                .ok_or_else(|| unexpected(format!("unresolved Do on page {page:?}")))
        })
        .collect()
}

/// The single form XObject in the resources of the form `wrapper`.
fn only_form_in(doc: &Document, wrapper: ObjectId) -> Result<ObjectId, ExportError> {
    let stream = doc
        .get_object(wrapper)
        .and_then(Object::as_stream)
        .map_err(rewrite_error)?;
    let xobjects = stream
        .dict
        .get(b"Resources")
        .and_then(|r| doc.dereference(r))
        .and_then(|(_, r)| r.as_dict())
        .and_then(|r| r.get(b"XObject"))
        .and_then(|x| doc.dereference(x))
        .and_then(|(_, x)| x.as_dict())
        .map_err(rewrite_error)?;
    let mut forms = xobjects.iter().filter_map(|(_, x)| x.as_reference().ok());
    match (forms.next(), forms.next()) {
        (Some(form), None) => Ok(form),
        _ => Err(unexpected(format!(
            "wrapper form {wrapper:?} does not hold exactly one form"
        ))),
    }
}

/// `object` from `source`, with every indirect object it references copied
/// into `output` too, so the copy needs nothing from `source`. `copied` maps
/// source ids to their copies, so shared objects are copied once.
fn deep_copy(
    source: &Document,
    output: &mut Document,
    object: &Object,
    copied: &mut HashMap<ObjectId, ObjectId>,
) -> Result<Object, ExportError> {
    Ok(match object {
        Object::Reference(id) => {
            if let Some(copy) = copied.get(id) {
                return Ok(Object::Reference(*copy));
            }
            // Reserve the id first, so a cycle back to this object resolves.
            let copy = output.new_object_id();
            copied.insert(*id, copy);
            let target = source.get_object(*id).map_err(rewrite_error)?;
            let value = deep_copy(source, output, target, copied)?;
            output.objects.insert(copy, value);
            Object::Reference(copy)
        }
        Object::Array(items) => Object::Array(
            items
                .iter()
                .map(|item| deep_copy(source, output, item, copied))
                .collect::<Result<_, _>>()?,
        ),
        Object::Dictionary(dict) => Object::Dictionary(copy_dict(source, output, dict, copied)?),
        Object::Stream(stream) => {
            // The stream's bytes are kept as stored, still encoded.
            let mut stream = stream.clone();
            stream.dict = copy_dict(source, output, &stream.dict, copied)?;
            Object::Stream(stream)
        }
        other => other.clone(),
    })
}

fn copy_dict(
    source: &Document,
    output: &mut Document,
    dict: &lopdf::Dictionary,
    copied: &mut HashMap<ObjectId, ObjectId>,
) -> Result<lopdf::Dictionary, ExportError> {
    let mut copy = lopdf::Dictionary::new();
    for (key, value) in dict.iter() {
        copy.set(key.clone(), deep_copy(source, output, value, copied)?);
    }
    Ok(copy)
}

fn rewrite_error(error: lopdf::Error) -> ExportError {
    ExportError::PageGroups(error.to_string())
}

fn unexpected(message: String) -> ExportError {
    ExportError::PageGroups(message)
}
