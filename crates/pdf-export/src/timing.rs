//! Stage timing for performance measurement. Off unless `BOOKCOMPOSER_TIMINGS`
//! is set to something other than empty or `0`; then each timed stage prints
//! one JSON line to stderr, `{"stage":"export.embed","ms":12.3}`, with any
//! extra numeric fields of the stage. When off, a stage just runs its closure.

use serde_json::{Map, Value, json};
use std::cell::RefCell;
use std::sync::OnceLock;
use std::time::Instant;

/// Whether timings are on for this process.
pub fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| {
        std::env::var("BOOKCOMPOSER_TIMINGS").is_ok_and(|v| !v.is_empty() && v != "0")
    })
}

fn print(stage: &str, ms: f64, fields: &[(&str, usize)]) {
    let mut line = Map::new();
    line.insert("stage".into(), json!(stage));
    line.insert("ms".into(), json!((ms * 1000.0).round() / 1000.0));
    for (key, value) in fields {
        line.insert((*key).into(), json!(value));
    }
    eprintln!("{}", Value::Object(line));
}

/// Runs `f` and prints how long it took as `name`.
pub fn stage<T>(name: &str, f: impl FnOnce() -> T) -> T {
    stage_with(name, &[], f)
}

/// Like [`stage`], with extra numeric `fields` on the line (a sheet number, say).
pub fn stage_with<T>(name: &str, fields: &[(&str, usize)], f: impl FnOnce() -> T) -> T {
    if !enabled() {
        return f();
    }
    let start = Instant::now();
    let result = f();
    print(name, start.elapsed().as_secs_f64() * 1000.0, fields);
    result
}

thread_local! {
    static TOTALS: RefCell<Vec<(&'static str, f64, usize)>> = const { RefCell::new(Vec::new()) };
}

/// Runs `f`, adding its time to the running total for `name`, for steps too
/// small and too many to print one by one. [`report_totals`] prints them.
pub fn accumulate<T>(name: &'static str, f: impl FnOnce() -> T) -> T {
    if !enabled() {
        return f();
    }
    let start = Instant::now();
    let result = f();
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    TOTALS.with_borrow_mut(
        |totals| match totals.iter_mut().find(|(n, _, _)| *n == name) {
            Some((_, total, count)) => {
                *total += ms;
                *count += 1;
            }
            None => totals.push((name, ms, 1)),
        },
    );
    result
}

/// Prints and clears every [`accumulate`] total, as `{"stage":name,"ms":total,"count":n}`.
pub fn report_totals() {
    if !enabled() {
        return;
    }
    for (name, ms, count) in TOTALS.take() {
        print(name, ms, &[("count", count)]);
    }
}
