//! `scripts/fetch-pdfium` installs only an archive whose SHA-256 matches the
//! pinned value. A `curl` shim stands in for the download.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A dir holding a `curl` that writes `archive` to the path after its
/// `--output` flag instead of downloading anything.
fn fake_curl(dir: &Path, archive: &Path) -> PathBuf {
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let shim = bin.join("curl");
    std::fs::write(
        &shim,
        format!(
            "#!/usr/bin/env bash\n\
             while [[ $# -gt 0 ]]; do\n\
             \x20 if [[ \"$1\" == --output ]]; then cp {} \"$2\"; exit 0; fi\n\
             \x20 shift\n\
             done\n\
             exit 1\n",
            archive.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

#[test]
fn archive_with_the_wrong_checksum_is_refused_and_dest_is_untouched() {
    let dir = std::env::temp_dir().join(format!("bookimposer-fetch-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let content = dir.join("content/lib");
    std::fs::create_dir_all(&content).unwrap();
    std::fs::write(content.join("libpdfium.so"), "not really PDFium").unwrap();
    let archive = dir.join("pdfium-linux-x64.tgz");
    let tar = Command::new("tar")
        .arg("-czf")
        .arg(&archive)
        .arg("-C")
        .arg(dir.join("content"))
        .arg("lib")
        .status()
        .unwrap();
    assert!(tar.success());
    let dest = dir.join("dest");
    std::fs::create_dir_all(&dest).unwrap();
    std::fs::write(dest.join("existing"), "kept").unwrap();

    let path = format!(
        "{}:{}",
        fake_curl(&dir, &archive).display(),
        std::env::var("PATH").unwrap()
    );
    let output = Command::new(repo().join("scripts/fetch-pdfium"))
        .env("PATH", path)
        .args(["--platform", "linux-x64", "--dest"])
        .arg(&dest)
        .output()
        .unwrap();
    let left_in_dest: Vec<_> = std::fs::read_dir(&dest)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("SHA-256 mismatch for pdfium-linux-x64.tgz"),
        "{stderr}"
    );
    assert_eq!(left_in_dest, ["existing"]);
}
