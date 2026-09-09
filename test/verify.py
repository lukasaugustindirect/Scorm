#!/usr/bin/env python3
"""Inspects the zips the converter produced.

Checks the things an LMS will care about: that the manifest parses, that it
carries the exact namespaces and schema versions its standard requires, that
the declared entry point exists in the archive, and that the adapter shipped
inside is the one matching the standard.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

REPO = Path(__file__).resolve().parent.parent

# Real XSD validation, which catches what namespace checks cannot -- notably
# child-order violations, since imsss:sequencingType is an xs:sequence.
# The _driver.xsd files import every namespace a manifest uses, giving xmllint
# one entry point. tincan.xsd is not publicly reachable, so xAPI has no entry.
SCHEMA_DRIVERS = {
    "scorm12": REPO / "schemas" / "scorm12" / "_driver.xsd",
    "scorm2004": REPO / "schemas" / "scorm2004" / "_driver.xsd",
    "cmi5": REPO / "schemas" / "cmi5-CourseStructure.xsd",
}

CP12 = "http://www.imsproject.org/xsd/imscp_rootv1p1p2"
ADLCP12 = "http://www.adlnet.org/xsd/adlcp_rootv1p2"
CP2004 = "http://www.imsglobal.org/xsd/imscp_v1p1"
ADLCP2004 = "http://www.adlnet.org/xsd/adlcp_v1p3"
ADLSEQ = "http://www.adlnet.org/xsd/adlseq_v1p3"
ADLNAV = "http://www.adlnet.org/xsd/adlnav_v1p3"
IMSSS = "http://www.imsglobal.org/xsd/imsss"
TINCAN = "http://projecttincan.com/tincan.xsd"
CMI5 = "https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd"

ACTIVITY_IRI = "https://example.com/courses/fixture"
MASTERY_PERCENT = 80
# Mirrors FIXTURE_TITLE in run.mjs. Carries diacritics deliberately: the title
# travels from the PDF's Info dictionary through the UI into manifest XML, and
# a mangled byte anywhere on that path shows up here.
COURSE_TITLE = "Bezpečnost práce 2026"


COMMON_FILES = ["index.html", "player.css", "player.js", "lms-adapter.js",
                "content/pages.json"]

# Call sites and data-model keys that prove the adapter is really wired to its
# standard's run-time, rather than merely mentioning it.
ADAPTER_MARKS = {
    "scorm12": ["api.LMSInitialize(", "cmi.core.lesson_status",
                "cmi.core.session_time"],
    "scorm2004": ["API_1484_11", "cmi.completion_status", "cmi.progress_measure"],
    "xapi": ["X-Experience-API-Version", "activity_id", "adlnet.gov/expapi/verbs"],
    "cmi5": ["LMS.LaunchData", "contextTemplate",
             "w3id.org/xapi/cmi5/context/categories/cmi5"],
}

# Each adapter declares its own identity, which is the only discriminator that
# is not confounded by prose: the SCORM 2004 adapter's comments mention
# LMSInitialize to contrast it with 1.2, and the cmi5 adapter legitimately
# speaks xAPI, so substring matching on either would misfire.
ADAPTER_LABELS = {
    "scorm12": "label: 'SCORM 1.2',",
    "scorm2004": "label: 'SCORM 2004 4th Edition',",
    "xapi": "label: 'xAPI',",
    "cmi5": "label: 'cmi5',",
}

failures = []
checks = 0


def check(ok, label, detail=""):
    global checks
    checks += 1
    if ok:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}" + (f" -- {detail}" if detail else ""))
        failures.append(label)


def q(ns, tag):
    return f"{{{ns}}}{tag}"


def resource_files(names):
    """Package entries that make up the resource, so must be declared.

    The manifest itself is excluded, and so is SCORM-schemas/: those are
    package-level metadata rather than part of the resource, which is how the
    ADL reference packages treat them too.
    """
    return {
        n for n in names
        if not n.endswith("/")
        and n != "imsmanifest.xml"
        and not n.startswith("SCORM-schemas/")
    }


def verify_common(zf, standard, page_count):
    names = set(zf.namelist())

    for path in COMMON_FILES:
        check(path in names, f"{standard}: contains {path}")

    text = zf.read("lms-adapter.js").decode("utf-8")
    for mark in ADAPTER_MARKS[standard]:
        check(mark in text, f"{standard}: adapter mentions {mark!r}")

    # The file check above would be satisfied by any adapter, so pin identity.
    check(ADAPTER_LABELS[standard] in text,
          f"{standard}: adapter declares itself as {standard}")
    for other, label in ADAPTER_LABELS.items():
        if other == standard:
            continue
        check(label not in text,
              f"{standard}: adapter is not the {other} one", f"found {label!r}")

    content = json.loads(zf.read("content/pages.json"))
    check(len(content.get("pages", [])) == page_count,
          f"{standard}: pages.json lists {page_count} pages",
          f"got {len(content.get('pages', []))}")
    check(content.get("standard") == standard,
          f"{standard}: pages.json records its standard")
    check(abs((content.get("masteryScore") or 0) - MASTERY_PERCENT / 100) < 1e-9,
          f"{standard}: mastery score normalised to 0-1",
          f"got {content.get('masteryScore')}")

    missing_images = [p["src"] for p in content["pages"]
                      if f"content/{p['src']}" not in names]
    check(not missing_images, f"{standard}: every page image is present",
          str(missing_images))

    has_text = [p for p in content["pages"] if p.get("text", "").strip()]
    check(len(has_text) == page_count,
          f"{standard}: extracted page text present for every page",
          f"got {len(has_text)}")
    if has_text:
        first = content["pages"][0]["text"]
        check("Fixture page 1" in first,
              f"{standard}: page 1 text matches the fixture",
              repr(first[:60]))

    geometry_ok = all(p.get("w", 0) > 0 and p.get("h", 0) > 0 for p in content["pages"])
    check(geometry_ok, f"{standard}: every page records pixel dimensions")

    return names


def parse(zf, path, standard):
    try:
        root = ElementTree.fromstring(zf.read(path))
        check(True, f"{standard}: {path} is well-formed XML")
        return root
    except ElementTree.ParseError as err:
        check(False, f"{standard}: {path} is well-formed XML", str(err))
        return None


def verify_scorm12(zf, names, page_count):
    root = parse(zf, "imsmanifest.xml", "scorm12")
    if root is None:
        return

    check(root.tag == q(CP12, "manifest"),
          "scorm12: manifest is in the imsproject imscp_rootv1p1p2 namespace",
          root.tag)

    meta = root.find(q(CP12, "metadata"))
    check(meta is not None and meta.findtext(q(CP12, "schema")) == "ADL SCORM",
          "scorm12: <schema> is 'ADL SCORM'")
    check(meta is not None and meta.findtext(q(CP12, "schemaversion")) == "1.2",
          "scorm12: <schemaversion> is '1.2'")

    resource = root.find(f"{q(CP12, 'resources')}/{q(CP12, 'resource')}")
    check(resource is not None, "scorm12: has a <resource>")
    if resource is None:
        return

    # SCORM 1.2 spells this all lower case; 2004 renamed it to scormType.
    check(resource.get(q(ADLCP12, "scormtype")) == "sco",
          "scorm12: resource is adlcp:scormtype='sco' (lower case)",
          str(resource.attrib))
    check(resource.get("href") == "index.html",
          "scorm12: resource href is index.html")

    declared = {f.get("href") for f in resource.findall(q(CP12, "file"))}
    packaged = resource_files(names)
    check(packaged.issubset(declared),
          "scorm12: every packaged file is declared in <file> elements",
          f"undeclared: {sorted(packaged - declared)[:5]}")

    item = root.find(f"{q(CP12, 'organizations')}/{q(CP12, 'organization')}/{q(CP12, 'item')}")
    check(item is not None and item.findtext(q(ADLCP12, "masteryscore")) == str(MASTERY_PERCENT),
          f"scorm12: adlcp:masteryscore is {MASTERY_PERCENT} (0-100 scale)")

    org = root.find(f"{q(CP12, 'organizations')}/{q(CP12, 'organization')}")
    titles = [org.findtext(q(CP12, "title")) if org is not None else None,
              item.findtext(q(CP12, "title")) if item is not None else None]
    check(all(t == COURSE_TITLE for t in titles),
          "scorm12: the course title kept its diacritics",
          repr(titles))


def verify_scorm2004(zf, names, page_count):
    root = parse(zf, "imsmanifest.xml", "scorm2004")
    if root is None:
        return

    check(root.tag == q(CP2004, "manifest"),
          "scorm2004: manifest is in the imsglobal imscp_v1p1 namespace", root.tag)

    meta = root.find(q(CP2004, "metadata"))
    check(meta is not None and meta.findtext(q(CP2004, "schema")) == "ADL SCORM",
          "scorm2004: <schema> is 'ADL SCORM'")
    check(meta is not None
          and meta.findtext(q(CP2004, "schemaversion")) == "2004 4th Edition",
          "scorm2004: <schemaversion> is '2004 4th Edition'",
          meta.findtext(q(CP2004, "schemaversion")) if meta is not None else "no metadata")

    resource = root.find(f"{q(CP2004, 'resources')}/{q(CP2004, 'resource')}")
    check(resource is not None, "scorm2004: has a <resource>")
    if resource is None:
        return

    check(resource.get(q(ADLCP2004, "scormType")) == "sco",
          "scorm2004: resource is adlcp:scormType='sco' (capital T)",
          str(resource.attrib))

    declared = {f.get("href") for f in resource.findall(q(CP2004, "file"))}
    packaged = resource_files(names)
    check(packaged.issubset(declared),
          "scorm2004: every packaged file is declared in <file> elements",
          f"undeclared: {sorted(packaged - declared)[:5]}")

    org = root.find(f"{q(CP2004, 'organizations')}/{q(CP2004, 'organization')}")
    item2004 = org.find(q(CP2004, "item")) if org is not None else None
    titles = [org.findtext(q(CP2004, "title")) if org is not None else None,
              item2004.findtext(q(CP2004, "title")) if item2004 is not None else None]
    check(all(t == COURSE_TITLE for t in titles),
          "scorm2004: the course title kept its diacritics", repr(titles))

    measure = root.find(
        f"{q(CP2004, 'organizations')}/{q(CP2004, 'organization')}/{q(CP2004, 'item')}/"
        f"{q(IMSSS, 'sequencing')}/{q(IMSSS, 'objectives')}/"
        f"{q(IMSSS, 'primaryObjective')}/{q(IMSSS, 'minNormalizedMeasure')}"
    )
    check(measure is not None and abs(float(measure.text) - MASTERY_PERCENT / 100) < 1e-9,
          "scorm2004: imsss:minNormalizedMeasure is the scaled mastery score",
          measure.text if measure is not None else "absent")

    nav = root.find(
        f"{q(CP2004, 'organizations')}/{q(CP2004, 'organization')}/{q(CP2004, 'item')}/"
        f"{q(ADLNAV, 'presentation')}"
    )
    check(nav is not None, "scorm2004: adlnav:presentation hides the LMS page controls")


def verify_xapi(zf, names, page_count):
    root = parse(zf, "tincan.xml", "xapi")
    if root is None:
        return

    check(root.tag == q(TINCAN, "tincan"),
          "xapi: tincan.xml root is in the tincan namespace", root.tag)

    activity = root.find(f"{q(TINCAN, 'activities')}/{q(TINCAN, 'activity')}")
    check(activity is not None, "xapi: declares an <activity>")
    if activity is None:
        return

    check(activity.get("id") == ACTIVITY_IRI,
          "xapi: activity id is the IRI given in the UI", activity.get("id"))
    check(activity.get("type") == "http://adlnet.gov/expapi/activities/course",
          "xapi: activity type is the ADL course activity type")
    name = activity.find(q(TINCAN, "name"))
    check(name is not None and "lang" not in name.attrib,
          "xapi: <name> carries no lang attribute, matching the reference files",
          str(name.attrib) if name is not None else "absent")
    check(name is not None and name.text == COURSE_TITLE,
          "xapi: the course title kept its diacritics",
          repr(name.text) if name is not None else "absent")
    desc = activity.find(q(TINCAN, "description"))
    check(desc is not None and desc.get("lang"),
          "xapi: <description> is language-tagged")

    launch = activity.findtext(q(TINCAN, "launch"))
    check(launch == "index.html", "xapi: <launch> points at index.html", str(launch))
    check(launch in names, "xapi: the launch target exists in the zip")


def verify_cmi5(zf, names, page_count):
    root = parse(zf, "cmi5.xml", "cmi5")
    if root is None:
        return

    check(root.tag == q(CMI5, "courseStructure"),
          "cmi5: root is courseStructure in the cmi5 XSD namespace", root.tag)

    course = root.find(q(CMI5, "course"))
    check(course is not None, "cmi5: has a <course>")
    check(course is not None and course.get("id") == ACTIVITY_IRI,
          "cmi5: course id is the IRI given in the UI")
    # The XSD makes description mandatory on both course and au.
    check(course is not None and course.find(q(CMI5, "description")) is not None,
          "cmi5: course carries the required <description>")

    au = root.find(q(CMI5, "au"))
    check(au is not None, "cmi5: has an <au>")
    if au is None:
        return

    check(au.get("id") and au.get("id") != ACTIVITY_IRI,
          "cmi5: au id is distinct from the course id", str(au.get("id")))

    titles = [
        t.findtext(q(CMI5, "langstring"))
        for parent in (course, au) if parent is not None
        for t in parent.findall(q(CMI5, "title"))
    ]
    check(titles and all(t == COURSE_TITLE for t in titles),
          "cmi5: the course title kept its diacritics", repr(titles))
    check(au.get("moveOn") in
          {"NotApplicable", "Passed", "Completed", "CompletedAndPassed", "CompletedOrPassed"},
          "cmi5: moveOn is one of the five allowed values", str(au.get("moveOn")))

    mastery = au.get("masteryScore")
    check(mastery is not None and 0 <= float(mastery) <= 1
          and abs(float(mastery) - MASTERY_PERCENT / 100) < 1e-9,
          "cmi5: masteryScore is a decimal 0-1", str(mastery))

    check(au.find(q(CMI5, "description")) is not None,
          "cmi5: au carries the required <description>")

    # auType is an xs:sequence, so the child order is part of validity.
    order = [child.tag.split("}")[-1] for child in au]
    expected = ["title", "description", "url"]
    check(order[:3] == expected,
          "cmi5: au children are in the schema's sequence order", str(order))

    url = au.findtext(q(CMI5, "url"))
    check(url == "index.html", "cmi5: <url> points at index.html", str(url))
    check(url in names, "cmi5: the launch target exists in the zip")


def validate_against_schema(zf, path, standard):
    """Validates the manifest with xmllint against the vendored schemas."""
    driver = SCHEMA_DRIVERS.get(standard)
    if driver is None:
        print(f"  --   {standard}: no public schema to validate against (tincan.xsd)")
        return
    if not shutil.which("xmllint"):
        print(f"  SKIP {standard}: xmllint not installed, schema validation skipped")
        return
    if not driver.exists():
        check(False, f"{standard}: schema driver exists", str(driver))
        return

    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / path
        target.write_bytes(zf.read(path))
        result = subprocess.run(
            ["xmllint", "--noout", "--schema", str(driver), str(target)],
            capture_output=True, text=True,
        )

    # scorm12/ims_xml.xsd makes the XML namespace its own default namespace,
    # which libxml warns about. That is a quirk of the ADL schema itself, so
    # the return code is what decides, not whether stderr is empty.
    detail = " | ".join(
        line for line in result.stderr.splitlines()
        if "validates" not in line and "ims_xml.xsd" not in line
        and "xml namespace URI" not in line and not line.startswith("filename=")
        and "^" not in line
    )
    check(result.returncode == 0,
          f"{standard}: {path} validates against the official schema", detail)


VERIFIERS = {
    "scorm12": verify_scorm12,
    "scorm2004": verify_scorm2004,
    "xapi": verify_xapi,
    "cmi5": verify_cmi5,
}


SCHEMA_NS_HINTS = {
    "scorm12": "SCORM-schemas/imscp_rootv1p1p2.xsd",
    "scorm2004": "SCORM-schemas/imsss_v1p0.xsd",
}


def verify_with_schemas(out, page_count):
    """Checks the variant built with "Include SCORM schema files" ticked."""
    folder = out / "withschemas"
    if not folder.is_dir():
        return

    print("\n--- packages built with schema files included ---")
    for path in sorted(folder.glob("*.zip")):
        standard = next((s for s in SCHEMA_DRIVERS if path.stem.endswith(s)), None)
        if standard not in SCHEMA_NS_HINTS:
            continue

        print(f"\n{path.name}  ({standard}, schemas on)")
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            expected = [n for n in names if n.startswith("SCORM-schemas/")]
            check(len(expected) >= 4,
                  f"{standard}: schema files are in the package",
                  f"found {len(expected)}")

            manifest = zf.read("imsmanifest.xml").decode("utf-8")
            check("xsi:schemaLocation" in manifest,
                  f"{standard}: xsi:schemaLocation is emitted when schemas ship")
            check(SCHEMA_NS_HINTS[standard] in manifest,
                  f"{standard}: schemaLocation points into SCORM-schemas/")

            # Every schemaLocation path must resolve to a file that is present,
            # which is the whole reason the attribute is conditional.
            hints = re.findall(r"(SCORM-schemas/[\w.]+\.xsd)", manifest)
            absent = sorted(h for h in hints if h not in names)
            check(not absent,
                  f"{standard}: every schemaLocation target exists in the zip",
                  str(absent))

            validate_against_schema(zf, "imsmanifest.xml", standard)

            # The schemas must not be declared as resource files.
            root = ElementTree.fromstring(manifest)
            ns = CP12 if standard == "scorm12" else CP2004
            resource = root.find(f"{q(ns, 'resources')}/{q(ns, 'resource')}")
            declared = {f.get("href") for f in resource.findall(q(ns, "file"))}
            check(not any(d.startswith("SCORM-schemas/") for d in declared),
                  f"{standard}: schema files are not declared as resource files")


CZECH_EXPECTED = {
    "next": "Další",
    "previous": "Předchozí",
    "returnToLms": "Zpět do LMS",
}


def verify_czech(out, page_count):
    """Checks the Czech build: the player's strings ship inside the package."""
    folder = out / "czech"
    if not folder.is_dir():
        return

    print("\n--- packages built in Czech ---")
    for path in sorted(folder.glob("*.zip")):
        standard = next((s for s in VERIFIERS if path.stem.endswith(s)), None)
        if standard is None:
            continue

        print(f"\n{path.name}  ({standard}, cs)")
        with zipfile.ZipFile(path) as zf:
            content = json.loads(zf.read("content/pages.json"))
            check(content.get("language") == "cs",
                  f"{standard}: pages.json records the course language",
                  str(content.get("language")))

            shipped = content.get("ui") or {}
            check(bool(shipped), f"{standard}: player strings ship in the package")
            for key, expected in CZECH_EXPECTED.items():
                check(shipped.get(key) == expected,
                      f"{standard}: player string {key!r} is Czech",
                      repr(shipped.get(key)))

            # A partially translated table must still be complete, because a
            # missing key leaves a button with no label at all.
            check(len(shipped) >= 26,
                  f"{standard}: player string table is complete",
                  f"{len(shipped)} keys")

            # cmi5 and xAPI carry the language in the manifest as well.
            if standard == "cmi5":
                root = ElementTree.fromstring(zf.read("cmi5.xml"))
                langs = {e.get("lang") for e in root.iter(q(CMI5, "langstring"))}
                check(langs == {"cs"},
                      "cmi5: every langstring is tagged cs", str(langs))
            if standard == "xapi":
                root = ElementTree.fromstring(zf.read("tincan.xml"))
                desc = root.find(f"{q(TINCAN, 'activities')}/{q(TINCAN, 'activity')}/"
                                 f"{q(TINCAN, 'description')}")
                check(desc is not None and desc.get("lang") == "cs",
                      "xapi: description is tagged cs",
                      desc.get("lang") if desc is not None else "absent")


MANIFEST_FOR = {
    "scorm12": "imsmanifest.xml",
    "scorm2004": "imsmanifest.xml",
    "cmi5": "cmi5.xml",
    "xapi": "tincan.xml",
}


def verify_package(path, page_count, label=""):
    """Runs every check on one built zip."""
    standard = next((s for s in VERIFIERS if path.stem.endswith(s)), None)
    suffix = f", {label}" if label else ""
    print(f"\n{path.name}  ({standard or 'unknown standard'}{suffix})")
    if standard is None:
        check(False, f"{path.name}: filename identifies a known standard")
        return

    with zipfile.ZipFile(path) as zf:
        bad = zf.testzip()
        check(bad is None, f"{standard}: archive is intact", str(bad))
        names = verify_common(zf, standard, page_count)
        VERIFIERS[standard](zf, names, page_count)
        validate_against_schema(zf, MANIFEST_FOR[standard], standard)


def verify_single_file(out, page_count):
    """The same checks against packages built by the single-file variant.

    It reaches into the app's internals -- a bundled build, a shimmed pdf.js,
    embedded assets -- so its output has to be proven identical, not assumed.
    """
    folder = out / "single"
    if not folder.is_dir():
        return
    print("\n--- packages built by the single-file variant (from file://) ---")
    for path in sorted(folder.glob("*.zip")):
        verify_package(path, page_count, label="single file")


def main():
    out = Path(sys.argv[1])
    page_count = int(sys.argv[2])

    zips = sorted(out.glob("*.zip"))
    if not zips:
        print("no packages were produced")
        return 1

    for path in zips:
        verify_package(path, page_count)

    verify_with_schemas(out, page_count)
    verify_czech(out, page_count)
    verify_single_file(out, page_count)

    missing = set(VERIFIERS) - {
        s for p in zips for s in VERIFIERS if p.stem.endswith(s)
    }
    if missing:
        check(False, f"a package was produced for every standard",
              f"missing: {sorted(missing)}")

    print(f"\n{checks - len(failures)}/{checks} checks passed")
    if failures:
        print(f"\n{len(failures)} FAILED:")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("all package checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
