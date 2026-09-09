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
// See scorm12.js for why xsi:schemaLocation is left out.

import { text, DECLARATION } from './xml.js';

export default {
  id: 'scorm2004',
  label: 'SCORM 2004 4th Edition',
  adapter: 'scorm2004',
  manifestName: 'imsmanifest.xml',

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

    return [{
      path: 'imsmanifest.xml',
      text: `${DECLARATION}
<manifest identifier="${text(course.identifier)}" version="1"
          xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
          xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
          xmlns:imsss="http://www.imsglobal.org/xsd/imsss">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}" adlseq:objectivesGlobalToSystem="false">
      <title>${text(course.title)}</title>
      <item identifier="${item}" identifierref="${res}" isvisible="true">
        <title>${text(course.title)}</title>
        <imsss:sequencing>
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>${objectives}
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
