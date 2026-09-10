// SCORM 1.2 content package.
//
// Namespaces verified against the ADL SCORM 1.2 Content Aggregation Model and
// the reference manifest at github.com/pipwerks/SCORM-Manifests.
//
// Two details bite people here:
//   - the content-packaging namespace is imsproject.org, not imsglobal.org;
//     that only changed in SCORM 2004.
//   - the resource attribute is adlcp:scormtype, all lower case. SCORM 2004
//     renamed it to adlcp:scormType, and using the wrong casing makes an LMS
//     treat the SCO as an asset, which silently disables all tracking.
//
// xsi:schemaLocation is emitted only when the package actually carries the
// schema files (the "Include SCORM schema files" option). Pointing the hint at
// .xsd files that are not there is worse than omitting it: a validating parser
// then fails to resolve the schema. Without them, LMSs key off the namespace
// plus <schema>/<schemaversion>, which are exact here.

import { text, DECLARATION } from './xml.js';

// The complete import closure: every schemaLocation inside these resolves to
// a sibling, so a validator needs no network access.
const SCHEMA_FILES = [
  'imscp_rootv1p1p2.xsd',
  'adlcp_rootv1p2.xsd',
  'imsmd_rootv1p2p1.xsd',
  'ims_xml.xsd',
];

const SCHEMA_LOCATION = [
  'http://www.imsproject.org/xsd/imscp_rootv1p1p2 SCORM-schemas/imscp_rootv1p1p2.xsd',
  'http://www.adlnet.org/xsd/adlcp_rootv1p2 SCORM-schemas/adlcp_rootv1p2.xsd',
  'http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 SCORM-schemas/imsmd_rootv1p2p1.xsd',
];

export default {
  id: 'scorm12',
  label: 'SCORM 1.2',
  adapter: 'scorm12',
  manifestName: 'imsmanifest.xml',
  schemaDir: 'scorm12',
  schemaFiles: SCHEMA_FILES,

  files(course, paths) {
    const org = `ORG-${course.identifier}`;
    const item = `ITEM-${course.identifier}`;
    const res = `RES-${course.identifier}`;

    // SCORM 1.2 scores are on a 0-100 scale, unlike the 0-1 scaled score of
    // SCORM 2004 and cmi5.
    const mastery = course.masteryScore == null
      ? ''
      : `\n        <adlcp:masteryscore>${Math.round(course.masteryScore * 100)}</adlcp:masteryscore>`;

    const fileList = paths
      .map((path) => `      <file href="${text(path)}"/>`)
      .join('\n');

    const schemaLocation = course.includeSchemas
      ? `\n          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n` +
        `          xsi:schemaLocation="${SCHEMA_LOCATION.join('\n                              ')}"`
      : '';

    return [{
      path: 'imsmanifest.xml',
      text: `${DECLARATION}
<manifest identifier="${text(course.identifier)}" version="1"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"${schemaLocation}>
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}">
      <title>${text(course.title)}</title>
      <item identifier="${item}" identifierref="${res}" isvisible="true">
        <title>${text(course.title)}</title>${mastery}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${res}" type="webcontent" adlcp:scormtype="sco" href="index.html">
${fileList}
    </resource>
  </resources>
</manifest>
`,
    }];
  },
};
