# Schema files

Vendored XSDs for the SCORM content-packaging and sequencing namespaces, used
for two things:

1. **Validation.** `npm test` validates every generated manifest against these
   with `xmllint`. `_driver.xsd` in each directory exists only to give xmllint a
   single entry point that imports all of a manifest's namespaces; it is not
   part of any standard and is never shipped inside a package.
2. **Optional packaging.** Tick "Include SCORM schema files" in the converter
   and these are copied into the package under `SCORM-schemas/`, with
   `xsi:schemaLocation` pointing at them. Off by default: most LMSs ignore the
   hint entirely and it adds weight to every package. Turn it on for an LMS
   that validates strictly on import.

Both file sets are the complete import closure — every `schemaLocation` in
them resolves to a sibling file, so validation needs no network access.

Source: [pipwerks/SCORM-Manifests](https://github.com/pipwerks/SCORM-Manifests),
which carries the ADL/IMS originals. `scorm12/ims_xml.xsd` makes the XML
namespace its default namespace, which libxml warns about; the warning comes
from the ADL schema itself, not from any manifest, and validation still
succeeds.
