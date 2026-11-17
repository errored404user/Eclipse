'use strict';

const { cloneState, normalizeState } = require('./state');

const BACKUP_FORMAT = 'eclipse-local-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 1024 * 1024;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateBackupEnvelope(value) {
  if (!isPlainObject(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error('This is not a supported Eclipse backup file.');
  }

  if (!isPlainObject(value.state) || !isPlainObject(value.state.settings) || !isPlainObject(value.state.ui)
    || !Array.isArray(value.state.profiles) || !Array.isArray(value.state.favorites)) {
    throw new Error('The Eclipse backup is missing required local state.');
  }

  return normalizeState(value.state);
}

function createBackupEnvelope(state, exportedAt = new Date().toISOString()) {
  const normalized = normalizeState(state);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    scope: 'Eclipse-owned profiles, favorites, preferences, and workspace state only.',
    state: cloneState(normalized)
  };
}

function summarizeBackup(state) {
  const normalized = normalizeState(state);
  return {
    profileCount: normalized.profiles.length,
    pinnedProfileCount: normalized.profiles.filter((profile) => profile.pinned).length,
    favoriteCount: normalized.favorites.length,
    preferenceCount: Object.keys(normalized.settings).length
  };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  createBackupEnvelope,
  summarizeBackup,
  validateBackupEnvelope
};
