// cmi5 course package.
//
// Structure verified against the cmi5 XSD at
// https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd
// (github.com/AICC/CMI-5_Spec_Current, v1/CourseStructure.xsd).
//
// Constraints taken straight from that schema:
//   - the file MUST be named cmi5.xml and sit at the zip root.
//   - <course> and <au> both REQUIRE a <description>, so it falls back to the
//     title rather than being omitted.
//   - <au> children are an ordered sequence: title, description, [objectives],
//     url, [launchParameters], [entitlementKey]. Reordering fails validation.
//   - masteryScore is a decimal from 0 to 1 inclusive.
//   - moveOn is one of NotApplicable, Passed, Completed, CompletedAndPassed,
//     CompletedOrPassed.
//   - course and au ids are xs:anyURI, which is why the activity IRI falls
//     back to a URN instead of a bare slug.

import { text, DECLARATION } from './xml.js';

const MOVE_ON = [
  'NotApplicable', 'Passed', 'Completed', 'CompletedAndPassed', 'CompletedOrPassed',
];

export default {
  id: 'cmi5',
  label: 'cmi5',
  adapter: 'cmi5',
  manifestName: 'cmi5.xml',

  files(course) {
    const lang = text(course.language || 'en');
    const description = text(course.description || course.title);
    const title = text(course.title);

    const moveOn = MOVE_ON.indexOf(course.moveOn) === -1 ? 'Completed' : course.moveOn;
    const mastery = course.masteryScore == null
      ? ''
      : ` masteryScore="${course.masteryScore.toFixed(4)}"`;

    // The AU id must differ from the activityId the LMS generates at launch,
    // so it is derived as a child of the course IRI.
    const auId = `${course.activityIri.replace(/\/?$/, '/')}au/1`;

    return [{
      path: 'cmi5.xml',
      text: `${DECLARATION}
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="${text(course.activityIri)}">
    <title><langstring lang="${lang}">${title}</langstring></title>
    <description><langstring lang="${lang}">${description}</langstring></description>
  </course>
  <au id="${text(auId)}" moveOn="${moveOn}"${mastery} launchMethod="AnyWindow">
    <title><langstring lang="${lang}">${title}</langstring></title>
    <description><langstring lang="${lang}">${description}</langstring></description>
    <url>index.html</url>
  </au>
</courseStructure>
`,
    }];
  },
};
