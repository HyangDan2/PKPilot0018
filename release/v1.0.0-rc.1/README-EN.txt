Sigrún v1.0.0-rc.1 — read me
=============================

version   1.0.0
release   v1.0.0-rc.1
build     973f2d7

What is in this folder
----------------------
  Sigrun-v1.0.0-rc.1.html          the entire application in one file
  Sigrun-v1.0.0-rc.1-Portable.zip  the same file plus a short read-me
  Sigrun-v1.0.0-rc.1-Web.zip       the static web build (serve the folder)
  SHA256SUMS.txt                    sha256 of every other file in this folder
  build-info.json                   version, commit, sizes, hashes
  LICENSES.txt                      third-party packages and licenses
  VERSION.txt                       one line: what this release is

Run the portable build
----------------------
1. Copy Sigrun-v1.0.0-rc.1.html anywhere on your machine.
2. Double-click it, or drag it into Microsoft Edge or Google Chrome.

There is nothing to install: no Node.js, no Python, no server, no network
connection. Every statistic, chart and export is computed in the browser tab.
Use File ▸ Save Project for anything that must outlive the browser profile.

Run the web build
-----------------
1. Unzip Sigrun-v1.0.0-rc.1-Web.zip into a folder.
2. Serve that folder with any static web server; open the folder's address.

Opening index.html directly from disk does not work for the web build (module
scripts need an origin); use the portable file for file:// use.

Verify the download
-------------------
  sha256sum -c SHA256SUMS.txt        (Linux)
  shasum -a 256 -c SHA256SUMS.txt    (macOS)

Every file except SHA256SUMS.txt itself is listed there.

Offline
-------
The hosted page and the portable file make no network request: the build is
audited in a real browser with every request recorded. The only outbound links
are the menu shortcuts to the project's home pages, and they are opened only
when a person clicks them.
