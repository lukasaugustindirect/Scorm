// SCORM 2004 4th Edition content package.
//
// Namespaces and <schemaversion> verified against the ADL SCORM 2004 4th
// Edition Test Suite manifests and github.com/pipwerks/SCORM-Manifests.
//
// The sequencing here is intentionally thin. A single-SCO page-turner needs no
// flow or rollup rules, and elaborate imsss blocks are a common reason an
// otherwise fine package is rejected on import. Only the pieces that carry
// real meaning are emitted:
//   - imsss:primaryObjective with minNormalizedMeasure, which is what populates
//     cmi.scaled_passing_score for the adapter, and only when a mastery score
//     was asked for.
//   - adlnav hiding of the LMS's own next/previous chrome, since the player
//     provides its own and two sets of page controls confuse learners.
//
// imsss:sequencingType is an xs:sequence, so child order is part of validity:
// controlMode, sequencingRules, limitConditions, auxiliaryResources,
// rollupRules, objectives, randomizationControls, deliveryControls,
// sequencingCollection. objectives therefore precedes deliveryControls -- the
// reverse parses as XML but is rejected by the schema.
//
// See scorm12.js for when xsi:schemaLocation is emitted.

import { text, DECLARATION } from './xml.js';

// The complete import closure. imsss is split across ten files, all pulled in
// by imsss_v1p0.xsd, so every one has to travel with the package.
const SCHEMA_FILES = [
  'imscp_v1p1.xsd',
  'adlcp_v1p3.xsd',
  'adlseq_v1p3.xsd',
  'adlnav_v1p3.xsd',
  'imsss_v1p0.xsd',
  'imsss_v1p0auxresource.xsd',
  'imsss_v1p0control.xsd',
  'imsss_v1p0delivery.xsd',
  'imsss_v1p0limit.xsd',
  'imsss_v1p0objective.xsd',
  'imsss_v1p0random.xsd',
  'imsss_v1p0rollup.xsd',
  'imsss_v1p0seqrule.xsd',
  'imsss_v1p0util.xsd',
  'xml.xsd',
];

const SCHEMA_LOCATION = [
  'http://www.imsglobal.org/xsd/imscp_v1p1 SCORM-schemas/imscp_v1p1.xsd',
  'http://www.adlnet.org/xsd/adlcp_v1p3 SCORM-schemas/adlcp_v1p3.xsd',
  'http://www.adlnet.org/xsd/adlseq_v1p3 SCORM-schemas/adlseq_v1p3.xsd',
  'http://www.adlnet.org/xsd/adlnav_v1p3 SCORM-schemas/adlnav_v1p3.xsd',
  'http://www.imsglobal.org/xsd/imsss SCORM-schemas/imsss_v1p0.xsd',
];

export default {
  id: 'scorm2004',
  label: 'SCORM 2004 4th Edition',
  adapter: 'scorm2004',
  manifestName: 'imsmanifest.xml',
  schemaDir: 'scorm2004',
  schemaFiles: SCHEMA_FILES,

  files(course, paths) {
    const org = `ORG-${course.identifier}`;
    const item = `ITEM-${course.identifier}`;
    const res = `RES-${course.identifier}`;

    // SCORM 2004 uses a scaled 0-1 measure, so the value passes through as-is.
    const objectives = course.masteryScore == null ? '' : `
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="PRIMARY" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${course.masteryScore.toFixed(4)}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>`;

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
          xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
          xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
          xmlns:imsss="http://www.imsglobal.org/xsd/imsss"${schemaLocation}>
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}" adlseq:objectivesGlobalToSystem="false">
      <title>${text(course.title)}</title>
      <item identifier="${item}" identifierref="${res}" isvisible="true">
        <title>${text(course.title)}</title>
        <imsss:sequencing>${objectives}
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>
        </imsss:sequencing>
        <adlnav:presentation>
          <adlnav:navigationInterface>
            <adlnav:hideLMSUI>continue</adlnav:hideLMSUI>
            <adlnav:hideLMSUI>previous</adlnav:hideLMSUI>
          </adlnav:navigationInterface>
        </adlnav:presentation>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${res}" type="webcontent" adlcp:scormType="sco" href="index.html">
${fileList}
    </resource>
  </resources>
</manifest>
`,
    }];
  },
};
