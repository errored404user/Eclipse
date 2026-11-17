'use strict';

function isOfficialClientDetected(installation) {
  return installation?.status === 'detected';
}

module.exports = {
  isOfficialClientDetected
};
