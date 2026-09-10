import scorm12 from './scorm12.js';
import scorm2004 from './scorm2004.js';
import xapi from './xapi.js';
import cmi5 from './cmi5.js';

export const STANDARDS = [scorm12, scorm2004, xapi, cmi5];

export const BY_ID = STANDARDS.reduce((map, standard) => {
  map[standard.id] = standard;
  return map;
}, Object.create(null));
