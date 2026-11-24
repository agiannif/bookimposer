//! Shares identical objects in an exported PDF. PDFium copies each placed
//! page's resources on their own, so a font or image that many source pages
//! share is written once per placement; merging the copies brings the output
//! back to about the size of the source.
//!
//! Objects are compared as stored: a stream matches another only when its
//! dictionary and its raw, still-encoded bytes are equal, and streams are
//! never decoded or re-encoded. Merging an object only rewrites the
//! references to it, so every page draws exactly the bytes it drew before.

use crate::timing;
use lopdf::{Dictionary, Document, Object, ObjectId};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};

/// Merges indirect objects that are identical, rewriting every reference to
/// one surviving copy, then prunes objects nothing references. Returns how
/// many objects were removed.
///
/// Objects are equal when their values are, with references compared by the
/// object they point to after earlier merges; so it repeats until nothing
/// merges, which lets two font dictionaries match once their font files
/// have. Pages, the page tree, the catalog and whatever the trailer points to
/// are never merged: their identity matters.
pub fn share_identical_objects(doc: &mut Document) -> usize {
    let protected = timing::stage("dedupe.protected", || protected_objects(doc));
    let mut removed = 0;
    timing::stage("dedupe.merge", || {
        loop {
            let merged = duplicates(doc, &protected);
            if merged.is_empty() {
                break;
            }
            for id in merged.keys() {
                doc.objects.remove(id);
            }
            removed += merged.len();
            for object in doc.objects.values_mut() {
                redirect(object, &merged);
            }
            redirect_dict(&mut doc.trailer, &merged);
        }
    });
    removed + timing::stage("dedupe.prune", || doc.prune_objects().len())
}

/// The objects whose identity matters: what the trailer references (the
/// catalog, the info dictionary), every node of the page tree, found by
/// walking it from the catalog's /Pages, and every page `get_pages` finds.
fn protected_objects(doc: &Document) -> HashSet<ObjectId> {
    let mut protected: HashSet<ObjectId> = doc
        .trailer
        .iter()
        .filter_map(|(_, value)| value.as_reference().ok())
        .chain(doc.get_pages().into_values())
        .collect();
    let root = doc.catalog().and_then(|catalog| catalog.get(b"Pages"));
    let mut nodes: Vec<ObjectId> = root.and_then(Object::as_reference).into_iter().collect();
    let mut walked = HashSet::new();
    while let Some(node) = nodes.pop() {
        // A malformed tree could loop back on itself.
        if !walked.insert(node) {
            continue;
        }
        protected.insert(node);
        let kids = doc
            .get_dictionary(node)
            .and_then(|node| node.get(b"Kids"))
            .and_then(Object::as_array);
        nodes.extend(
            kids.into_iter()
                .flatten()
                .filter_map(|kid| kid.as_reference().ok()),
        );
    }
    protected
}

/// Each object that equals an earlier one (in id order), mapped to that
/// earlier object. The earlier one is never a key, so one pass of
/// [`redirect`] settles every reference.
fn duplicates(doc: &Document, protected: &HashSet<ObjectId>) -> BTreeMap<ObjectId, ObjectId> {
    let mut kept: HashMap<u64, Vec<ObjectId>> = HashMap::new();
    let mut merged = BTreeMap::new();
    for (id, object) in &doc.objects {
        if protected.contains(id) {
            continue;
        }
        let mut hasher = DefaultHasher::new();
        hash_object(object, &mut hasher);
        let candidates = kept.entry(hasher.finish()).or_default();
        // Equal hashes only shortlist; the objects themselves must be equal.
        match candidates
            .iter()
            .find(|other| same(&doc.objects[other], object))
        {
            Some(survivor) => {
                merged.insert(*id, *survivor);
            }
            None => candidates.push(*id),
        }
    }
    merged
}

/// Whether two objects are identical as stored. A stream's position in the
/// file and whether lopdf may compress it are not part of its value.
fn same(a: &Object, b: &Object) -> bool {
    match (a, b) {
        (Object::Stream(a), Object::Stream(b)) => a.dict == b.dict && a.content == b.content,
        (a, b) => a == b,
    }
}

/// Hashes `object` consistently with [`same`]: dictionary entries in key
/// order, since equal dictionaries may store their keys in different orders.
fn hash_object(object: &Object, state: &mut impl Hasher) {
    std::mem::discriminant(object).hash(state);
    match object {
        Object::Null => {}
        Object::Boolean(value) => value.hash(state),
        Object::Integer(value) => value.hash(state),
        Object::Real(value) => value.to_bits().hash(state),
        Object::Name(name) => name.hash(state),
        Object::String(bytes, format) => {
            bytes.hash(state);
            (*format as u8).hash(state);
        }
        Object::Array(items) => {
            items.len().hash(state);
            for item in items {
                hash_object(item, state);
            }
        }
        Object::Dictionary(dict) => hash_dict(dict, state),
        Object::Stream(stream) => {
            hash_dict(&stream.dict, state);
            stream.content.hash(state);
        }
        Object::Reference(id) => id.hash(state),
    }
}

fn hash_dict(dict: &Dictionary, state: &mut impl Hasher) {
    let mut entries: Vec<_> = dict.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    entries.len().hash(state);
    for (key, value) in entries {
        key.hash(state);
        hash_object(value, state);
    }
}

/// Points every reference in `object` that `merged` maps to its survivor.
fn redirect(object: &mut Object, merged: &BTreeMap<ObjectId, ObjectId>) {
    match object {
        Object::Reference(id) => {
            if let Some(survivor) = merged.get(id) {
                *id = *survivor;
            }
        }
        Object::Array(items) => items.iter_mut().for_each(|item| redirect(item, merged)),
        Object::Dictionary(dict) => redirect_dict(dict, merged),
        Object::Stream(stream) => redirect_dict(&mut stream.dict, merged),
        _ => {}
    }
}

fn redirect_dict(dict: &mut Dictionary, merged: &BTreeMap<ObjectId, ObjectId>) {
    for (_, value) in dict.iter_mut() {
        redirect(value, merged);
    }
}
