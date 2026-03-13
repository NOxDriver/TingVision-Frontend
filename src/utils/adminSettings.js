import { buildLegacyLocationIds, uniqueIds } from './access';

const slugPattern = /[^a-z0-9]+/g;
const CAMERA_UI_ONLY_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'clientId',
  'displayName',
  'siteName',
  'network',
  'geo',
  'tour',
  'features',
  'overrides',
  'storage',
];
export const CAMERA_MANAGED_CONFIG_KEYS = [
  'location_id',
  'client_id',
  'display_name',
  'enabled',
  'public_ip_address',
  'private_ip_address',
  'ptz_channel',
  'ptz_http_port',
  'rtsp_port',
  'rtsp_path',
  'rtsp_subtype',
  'dahua_api_version',
  'MOTION_VERIFY_CAMERA_TIMEZONE',
  'MOTION_VERIFY_CAMERA_LAT',
  'MOTION_VERIFY_CAMERA_LON',
  'TOUR_MODE',
  'DAY_TOUR_PRESET_IDS',
  'NIGHT_TOUR_PRESET_IDS',
  'PRESET_MOVE_SETTLE_SEC',
  'PTZ_PRESETS',
];
const PRESET_UI_ONLY_KEYS = [
  'id',
  'createdAt',
  'updatedAt',
  'backendId',
  'whenIsActive',
  'distanceM',
  'when',
  'profile',
];

export const slugifyId = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .replace(slugPattern, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

const deepCloneValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(deepCloneValue);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, nestedValue]) => {
      acc[key] = deepCloneValue(nestedValue);
      return acc;
    }, {});
  }

  return value;
};

const firstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const deleteKeys = (target, keys = []) => {
  keys.forEach((key) => {
    delete target[key];
  });
};

const isScalarFieldValue = (value) => (
  value === ''
  || typeof value === 'string'
  || typeof value === 'number'
  || typeof value === 'boolean'
);

export const createEmptyClientDraft = () => ({
  name: '',
  address: '',
  geo: {
    lat: '',
    lon: '',
  },
  enabled: true,
  timezone: 'Africa/Johannesburg',
});

export const createEmptyCameraDraft = () => ({
  clientId: '',
  displayName: '',
  enabled: true,
  network: {
    publicIp: '',
    privateIp: '',
    ptzChannel: '',
    ptzHttpPort: 80,
    rtspPort: 554,
    rtspPath: '/cam/realmonitor',
    rtspSubtype: 0,
    dahuaApiVersion: 'v2',
  },
  geo: {
    lat: '',
    lon: '',
    timezone: '',
  },
  tour: {
    mode: 'auto',
    dayPresetIds: [],
    nightPresetIds: [],
  },
  overrides: {
    presetMoveSettleSec: 5,
  },
});

export const createEmptyPresetDraft = () => ({
  backendId: '',
  name: '',
  whenIsActive: 'Day',
  profile: 'Day',
  spotter: 'motion',
  distanceM: '',
  side_of_camera: '',
  side_of_river: '',
  enabled: true,
});

export const prettyPrintJson = (value) => JSON.stringify(value, null, 2);

export const parseJsonObject = (text) => {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON must be an object.');
  }
  return parsed;
};

export const updateNestedValue = (source, path, value) => {
  const keys = Array.isArray(path) ? path : String(path).split('.');
  const next = deepCloneValue(source);
  let cursor = next;

  keys.forEach((key, index) => {
    const isLeaf = index === keys.length - 1;
    if (isLeaf) {
      cursor[key] = value;
      return;
    }

    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }

    cursor = cursor[key];
  });

  return next;
};

export const setTopLevelField = (source, key, value) => {
  const next = deepCloneValue(source);
  next[key] = value;
  return next;
};

export const removeTopLevelField = (source, key) => {
  const next = deepCloneValue(source);
  delete next[key];
  return next;
};

export const coerceSimpleFieldValue = (value, type = 'text') => {
  if (type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }

    return String(value || '').trim().toLowerCase() === 'true';
  }

  if (type === 'number') {
    if (value === '' || value === null || value === undefined) {
      return 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }

  return String(value ?? '');
};

export const isReservedCameraFieldName = (key) => (
  CAMERA_UI_ONLY_KEYS.includes(key)
  || CAMERA_MANAGED_CONFIG_KEYS.includes(key)
);

export const listCameraExtraFields = (draft = {}) => Object.entries(draft || {})
  .filter(([key, value]) => !isReservedCameraFieldName(key) && isScalarFieldValue(value))
  .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { sensitivity: 'base' }))
  .map(([key, value]) => ({
    key,
    value,
    type:
      typeof value === 'boolean'
        ? 'boolean'
        : (typeof value === 'number' && Number.isFinite(value) ? 'number' : 'text'),
  }));

const mergeDraft = (defaults, data = {}) => {
  const next = deepCloneValue(defaults);

  Object.entries(data || {}).forEach(([key, value]) => {
    if (key === 'createdAt' || key === 'updatedAt') {
      return;
    }

    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && next[key]
      && typeof next[key] === 'object'
      && !Array.isArray(next[key])
    ) {
      next[key] = mergeDraft(next[key], value);
      return;
    }

    next[key] = deepCloneValue(value);
  });

  return next;
};

export const hydrateClientDraft = (data = {}) => mergeDraft(createEmptyClientDraft(), data);
export const hydrateCameraDraft = (data = {}) => {
  const next = mergeDraft(createEmptyCameraDraft(), data);
  const presetObjects = Array.isArray(firstDefined(data?.PTZ_PRESETS, next?.PTZ_PRESETS))
    ? firstDefined(data?.PTZ_PRESETS, next?.PTZ_PRESETS)
    : [];
  delete next.storage;
  if (next.network && typeof next.network === 'object') {
    delete next.network.authSecretName;
  }

  next.clientId = trimString(firstDefined(data?.clientId, data?.client_id, next?.clientId)) || '';
  next.displayName = trimString(
    firstDefined(data?.displayName, data?.display_name, next?.displayName),
  ) || '';
  next.enabled = firstDefined(data?.enabled, next?.enabled) !== false;

  next.network = {
    ...next.network,
    publicIp: trimString(
      firstDefined(
        data?.network?.publicIp,
        data?.publicIp,
        data?.public_ip_address,
        next?.network?.publicIp,
      ),
    ) || '',
    privateIp: trimString(
      firstDefined(
        data?.network?.privateIp,
        data?.privateIp,
        data?.private_ip_address,
        next?.network?.privateIp,
      ),
    ) || '',
    ptzChannel: firstDefined(
      data?.network?.ptzChannel,
      data?.ptz_channel,
      next?.network?.ptzChannel,
    ) ?? '',
    ptzHttpPort: firstDefined(
      data?.network?.ptzHttpPort,
      data?.ptz_http_port,
      next?.network?.ptzHttpPort,
    ) ?? '',
    rtspPort: firstDefined(
      data?.network?.rtspPort,
      data?.rtsp_port,
      next?.network?.rtspPort,
    ) ?? '',
    rtspPath: trimString(
      firstDefined(
        data?.network?.rtspPath,
        data?.rtsp_path,
        next?.network?.rtspPath,
      ),
    ) || '',
    rtspSubtype: firstDefined(
      data?.network?.rtspSubtype,
      data?.rtsp_subtype,
      next?.network?.rtspSubtype,
    ) ?? '',
    dahuaApiVersion: trimString(
      firstDefined(
        data?.network?.dahuaApiVersion,
        data?.dahua_api_version,
        next?.network?.dahuaApiVersion,
      ),
    ) || '',
  };

  next.geo = {
    ...next.geo,
    lat: firstDefined(
      data?.geo?.lat,
      data?.MOTION_VERIFY_CAMERA_LAT,
      next?.geo?.lat,
    ) ?? '',
    lon: firstDefined(
      data?.geo?.lon,
      data?.MOTION_VERIFY_CAMERA_LON,
      next?.geo?.lon,
    ) ?? '',
    timezone: trimString(
      firstDefined(
        data?.geo?.timezone,
        data?.MOTION_VERIFY_CAMERA_TIMEZONE,
        next?.geo?.timezone,
      ),
    ) || '',
  };

  next.tour = {
    ...next.tour,
    mode: trimString(firstDefined(data?.tour?.mode, data?.TOUR_MODE, next?.tour?.mode)) || 'auto',
    dayPresetIds: firstDefined(
      data?.tour?.dayPresetIds,
      data?.DAY_TOUR_PRESET_IDS,
      next?.tour?.dayPresetIds,
    ) || [],
    nightPresetIds: firstDefined(
      data?.tour?.nightPresetIds,
      data?.NIGHT_TOUR_PRESET_IDS,
      next?.tour?.nightPresetIds,
    ) || [],
  };

  const waterSegEnabled = firstDefined(data?.WATERSEG_ENABLE, data?.features?.waterSegEnabled);
  if (waterSegEnabled !== undefined) {
    next.WATERSEG_ENABLE = Boolean(waterSegEnabled);
  }

  const motionMaskEnabled = firstDefined(data?.MOTIONMASK_ENABLE, data?.features?.motionMaskEnabled);
  if (motionMaskEnabled !== undefined) {
    next.MOTIONMASK_ENABLE = Boolean(motionMaskEnabled);
  }

  delete next.features;

  next.overrides = {
    ...next.overrides,
    presetMoveSettleSec: firstDefined(
      data?.overrides?.presetMoveSettleSec,
      data?.PRESET_MOVE_SETTLE_SEC,
      next?.overrides?.presetMoveSettleSec,
    ) ?? '',
  };

  if (
    Array.isArray(presetObjects)
    && presetObjects.length > 0
    && (!Array.isArray(next.tour.dayPresetIds) || next.tour.dayPresetIds.length === 0)
    && (!Array.isArray(next.tour.nightPresetIds) || next.tour.nightPresetIds.length === 0)
  ) {
    const derivedDayIds = [];
    const derivedNightIds = [];

    presetObjects.forEach((preset) => {
      const rawId = firstDefined(preset?.backend_id, preset?.backendId, preset?.id);
      const presetId = Number(rawId);
      if (!Number.isFinite(presetId)) {
        return;
      }

      const when = String(
        firstDefined(preset?.when_is_active, preset?.whenIsActive, preset?.when, ''),
      )
        .trim()
        .toLowerCase();

      if (when.startsWith('day')) {
        derivedDayIds.push(presetId);
        return;
      }

      if (when.startsWith('night')) {
        derivedNightIds.push(presetId);
        return;
      }

      derivedDayIds.push(presetId);
      derivedNightIds.push(presetId);
    });

    if ((!Array.isArray(next.tour.dayPresetIds) || next.tour.dayPresetIds.length === 0) && derivedDayIds.length > 0) {
      next.tour.dayPresetIds = derivedDayIds;
    }

    if ((!Array.isArray(next.tour.nightPresetIds) || next.tour.nightPresetIds.length === 0) && derivedNightIds.length > 0) {
      next.tour.nightPresetIds = derivedNightIds;
    }
  }

  return next;
};
export const hydratePresetDraft = (data = {}) => {
  const next = mergeDraft(createEmptyPresetDraft(), data);
  const rawWhenIsActive = normalizePresetWhenIsActive(trimString(
    firstDefined(data?.whenIsActive, data?.when_is_active, data?.when, next?.whenIsActive),
  )) || 'Day';
  const rawSpotter = trimString(firstDefined(data?.spotter, next?.spotter)) || 'motion';

  next.backendId = toNumberOrUndefined(
    firstDefined(data?.backendId, data?.backend_id, next?.backendId),
  ) ?? '';
  next.whenIsActive = rawWhenIsActive;
  next.profile = resolvePresetProfileValue(data, rawWhenIsActive)
    || getDefaultPresetProfile(rawWhenIsActive);
  next.spotter = rawSpotter;
  next.distanceM = toNumberOrUndefined(
    firstDefined(data?.distanceM, data?.distance_m, next?.distanceM),
  ) ?? '';
  next.side_of_camera = normalizePresetSideOfCamera(
    firstDefined(data?.side_of_camera, next?.side_of_camera),
  ) || '';
  next.side_of_river = trimString(firstDefined(data?.side_of_river, next?.side_of_river)) || '';
  next.enabled = firstDefined(data?.enabled, next?.enabled) !== false;

  return next;
};

const trimString = (value) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim();
};

const normalizePresetSideOfCamera = (value) => {
  const normalized = trimString(value);

  if (normalized === 'far_left') {
    return 'far left';
  }

  if (normalized === 'far_right') {
    return 'far right';
  }

  return normalized;
};

export const getDefaultPresetProfile = (whenIsActive) => {
  const normalized = String(trimString(whenIsActive) || '').toLowerCase();

  if (normalized.startsWith('day')) {
    return 'Day';
  }

  if (normalized.startsWith('night')) {
    return 'Custom1';
  }

  return '';
};

const normalizePresetWhenIsActive = (whenIsActive) => {
  const rawValue = String(trimString(whenIsActive) || '');
  const normalized = rawValue.toLowerCase();

  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('day')) {
    return 'Day';
  }

  if (normalized.startsWith('night')) {
    return 'Night';
  }

  if (normalized === 'never') {
    return 'NEVER';
  }

  if (
    normalized === 'both'
    || normalized === 'always'
    || normalized === 'all'
    || normalized === 'any'
    || normalized === '24x7'
    || normalized === '24/7'
    || normalized === 'nightandday'
    || normalized === 'dayandnight'
  ) {
    return 'NightAndDay';
  }

  return rawValue;
};

const resolvePresetProfileValue = (data = {}, whenIsActive = '') => {
  const normalizedWhen = String(whenIsActive || '').trim().toLowerCase();

  if (normalizedWhen.startsWith('night')) {
    return trimString(
      firstDefined(data?.profile, data?.nightProfile, data?.night_profile),
    ) || getDefaultPresetProfile(whenIsActive);
  }

  return trimString(
    firstDefined(
      data?.profile,
      data?.dayProfile,
      data?.day_profile,
      data?.nightProfile,
      data?.night_profile,
    ),
  ) || getDefaultPresetProfile(whenIsActive);
};

const resolvePresetStoredProfile = (draft = {}, whenIsActive = '') => {
  const explicitProfile = trimString(draft?.profile);
  const dayProfile = trimString(firstDefined(draft?.dayProfile, draft?.day_profile));
  const nightProfile = trimString(firstDefined(draft?.nightProfile, draft?.night_profile));
  const normalizedWhen = String(whenIsActive || '').trim().toLowerCase();

  if (explicitProfile) {
    return explicitProfile;
  }

  if (normalizedWhen.startsWith('day')) {
    return dayProfile || nightProfile || getDefaultPresetProfile(whenIsActive);
  }

  if (normalizedWhen.startsWith('night')) {
    return nightProfile || dayProfile || getDefaultPresetProfile(whenIsActive);
  }

  return dayProfile || nightProfile || getDefaultPresetProfile(whenIsActive);
};

const toNumberOrUndefined = (value) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toTokenArray = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const toPresetArray = (value) => toTokenArray(value).map((item) => {
  const parsed = Number(item);
  return Number.isFinite(parsed) ? parsed : item;
});

const cleanFirestoreValue = (value) => {
  if (Array.isArray(value)) {
    return value
      .map(cleanFirestoreValue)
      .filter((entry) => entry !== undefined);
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const next = Object.entries(value).reduce((acc, [key, nestedValue]) => {
      const cleaned = cleanFirestoreValue(nestedValue);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {});

    return Object.keys(next).length > 0 ? next : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (value === undefined) {
    return undefined;
  }

  return value;
};

export const serializeClientDocument = (draft = {}) => {
  const next = {
    ...deepCloneValue(draft),
    name: trimString(draft?.name) || '',
    address: trimString(draft?.address) || '',
    geo: {
      ...draft?.geo,
      lat: toNumberOrUndefined(draft?.geo?.lat),
      lon: toNumberOrUndefined(draft?.geo?.lon),
    },
    timezone: trimString(draft?.timezone) || 'Africa/Johannesburg',
    enabled: draft?.enabled !== false,
  };
  delete next.id;
  delete next.createdAt;
  delete next.updatedAt;

  return cleanFirestoreValue(next) || createEmptyClientDraft();
};

export const serializePresetConfigList = (presets = []) => {
  if (!Array.isArray(presets)) {
    return [];
  }

  return presets
    .map((preset) => serializePresetDocument(preset))
    .filter((preset) => preset && Object.keys(preset).length > 0)
    .sort((left, right) => {
      const leftId = typeof left.backendId === 'number'
        ? left.backendId
        : (typeof left.backend_id === 'number' ? left.backend_id : Number.POSITIVE_INFINITY);
      const rightId = typeof right.backendId === 'number'
        ? right.backendId
        : (typeof right.backend_id === 'number' ? right.backend_id : Number.POSITIVE_INFINITY);

      if (leftId !== rightId) {
        return leftId - rightId;
      }

      return String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' });
    });
};

export const serializeCameraDocument = (draft = {}, { cameraId = '', presets } = {}) => {
  const next = deepCloneValue(draft);
  const resolvedPresets = Array.isArray(presets)
    ? presets
    : next?.PTZ_PRESETS;

  deleteKeys(next, CAMERA_UI_ONLY_KEYS);

  next.location_id = trimString(cameraId || draft?.location_id || draft?.id) || undefined;
  next.client_id = trimString(firstDefined(draft?.clientId, draft?.client_id)) || undefined;
  next.display_name = trimString(firstDefined(draft?.displayName, draft?.display_name)) || undefined;
  next.enabled = firstDefined(draft?.enabled, next?.enabled) !== false;

  next.public_ip_address = trimString(
    firstDefined(draft?.network?.publicIp, draft?.public_ip_address),
  ) || undefined;
  next.private_ip_address = trimString(
    firstDefined(draft?.network?.privateIp, draft?.private_ip_address),
  ) || undefined;
  next.ptz_channel = toNumberOrUndefined(
    firstDefined(draft?.network?.ptzChannel, draft?.ptz_channel),
  );
  next.ptz_http_port = toNumberOrUndefined(
    firstDefined(draft?.network?.ptzHttpPort, draft?.ptz_http_port),
  );
  next.rtsp_port = toNumberOrUndefined(
    firstDefined(draft?.network?.rtspPort, draft?.rtsp_port),
  );
  next.rtsp_path = trimString(
    firstDefined(draft?.network?.rtspPath, draft?.rtsp_path),
  ) || undefined;
  next.rtsp_subtype = toNumberOrUndefined(
    firstDefined(draft?.network?.rtspSubtype, draft?.rtsp_subtype),
  );
  next.dahua_api_version = trimString(
    firstDefined(draft?.network?.dahuaApiVersion, draft?.dahua_api_version),
  ) || undefined;

  next.MOTION_VERIFY_CAMERA_TIMEZONE = trimString(
    firstDefined(draft?.geo?.timezone, draft?.MOTION_VERIFY_CAMERA_TIMEZONE),
  ) || undefined;
  next.MOTION_VERIFY_CAMERA_LAT = toNumberOrUndefined(
    firstDefined(draft?.geo?.lat, draft?.MOTION_VERIFY_CAMERA_LAT),
  );
  next.MOTION_VERIFY_CAMERA_LON = toNumberOrUndefined(
    firstDefined(draft?.geo?.lon, draft?.MOTION_VERIFY_CAMERA_LON),
  );

  next.TOUR_MODE = trimString(
    firstDefined(draft?.tour?.mode, draft?.TOUR_MODE),
  ) || undefined;
  next.DAY_TOUR_PRESET_IDS = toPresetArray(
    firstDefined(draft?.tour?.dayPresetIds, draft?.DAY_TOUR_PRESET_IDS),
  );
  next.NIGHT_TOUR_PRESET_IDS = toPresetArray(
    firstDefined(draft?.tour?.nightPresetIds, draft?.NIGHT_TOUR_PRESET_IDS),
  );
  next.PRESET_MOVE_SETTLE_SEC = toNumberOrUndefined(
    firstDefined(draft?.overrides?.presetMoveSettleSec, draft?.PRESET_MOVE_SETTLE_SEC),
  );

  if (Array.isArray(resolvedPresets)) {
    next.PTZ_PRESETS = serializePresetConfigList(resolvedPresets);
  }

  return cleanFirestoreValue(next) || {};
};

export const serializePresetDocument = (draft = {}) => {
  const next = deepCloneValue(draft);

  deleteKeys(next, PRESET_UI_ONLY_KEYS);
  delete next.backend_id;
  delete next.when_is_active;
  delete next.dayProfile;
  delete next.nightProfile;
  delete next.day_profile;
  delete next.night_profile;

  const whenIsActive = normalizePresetWhenIsActive(
    firstDefined(draft?.whenIsActive, draft?.when_is_active, draft?.when),
  );

  next.backendId = toNumberOrUndefined(firstDefined(draft?.backendId, draft?.backend_id));
  next.name = trimString(next.name);
  next.whenIsActive = whenIsActive || undefined;
  next.profile = resolvePresetStoredProfile(draft, whenIsActive) || undefined;
  next.spotter = trimString(next.spotter);
  next.distance_m = toNumberOrUndefined(firstDefined(draft?.distanceM, draft?.distance_m));
  next.side_of_camera = normalizePresetSideOfCamera(
    firstDefined(draft?.side_of_camera, next?.side_of_camera),
  ) || undefined;
  next.side_of_river = trimString(firstDefined(draft?.side_of_river, next?.side_of_river)) || undefined;
  next.enabled = firstDefined(draft?.enabled, next?.enabled) !== false;

  return cleanFirestoreValue(next) || {};
};

export const toCommaSeparatedList = (value) => {
  if (!Array.isArray(value)) {
    return '';
  }

  return value.join(', ');
};

export const formatUserLabel = (user = {}) => {
  const fullName = trimString(user.fullName);
  const email = trimString(user.email);

  if (fullName && email) {
    return `${fullName} (${email})`;
  }

  return fullName || email || user.id || 'Unknown user';
};

export const buildUserAccessDraft = ({
  user = {},
  cameraLookup = new Map(),
} = {}) => {
  const cameraIds = uniqueIds(user.cameraIds);
  const currentLocationIds = uniqueIds(user.locationIds);
  const manualLocationIds = currentLocationIds.filter((value) => !cameraIds.includes(value));
  const derivedClientIds = uniqueIds(
    cameraIds.map((cameraId) => cameraLookup.get(cameraId)?.clientId).filter(Boolean),
  );

  return {
    role: user.role === 'admin' ? 'admin' : 'client',
    cameraIds,
    clientIds: derivedClientIds,
    manualLocationIds,
  };
};

export const serializeUserAccessDocument = (draft = {}) => {
  const cameraIds = uniqueIds(draft?.cameraIds);
  const clientIds = uniqueIds(draft?.clientIds);
  const manualLocationIds = uniqueIds(draft?.manualLocationIds);

  return {
    role: draft?.role === 'admin' ? 'admin' : 'client',
    cameraIds,
    clientIds,
    locationIds: buildLegacyLocationIds({
      cameraIds,
      extraLocationIds: manualLocationIds,
    }),
  };
};
