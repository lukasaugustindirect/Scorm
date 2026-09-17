// xAPI (TinCan) package.
//
// tincan.xml is a Rustici convention rather than a ratified standard -- there
// is no IMS or ADL document defining it -- but it is what LMSs mean when they
// advertise "xAPI package" support, and it is what Rustici Engine, Cornerstone
// and Moodle's tincanlaunch module all read. The file must sit at the zip root;
// its location defines the package root.
//
// The runtime contract that actually matters is the launch query string
// (endpoint, auth, actor, registration, activity_id), which the shipped
// adapter reads. See player/adapters/xapi.js.
//
// <name> deliberately carries no lang attribute while <description> and
// <launch> do. That asymmetry is what the reference files actually contain --
// adaptlearning/adapt-contrib-xapi and Rustici's own documented examples --
// and since tincan.xsd is not reachable to confirm the attribute is permitted
// on <name>, omitting an optional attribute is the choice that cannot be
// invalid either way.

import { text, DECLARATION } from './xml.js';

export default {
  id: 'xapi',
  label: 'xAPI',
  adapter: 'xapi',
  manifestName: 'tincan.xml',

  files(course) {
    const lang = text(course.language || 'en');

    return [{
      path: 'tincan.xml',
      text: `${DECLARATION}
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${text(course.activityIri)}" type="http://adlnet.gov/expapi/activities/course">
      <name>${text(course.title)}</name>
      <description lang="${lang}">${text(course.description || course.title)}</description>
      <launch lang="${lang}">index.html</launch>
    </activity>
  </activities>
</tincan>
`,
    }];
  },
};
