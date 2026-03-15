/* eslint-disable require-jsdoc */
const crypto = require("crypto");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const {
  SecretManagerServiceClient,
} = require("@google-cloud/secret-manager");

admin.initializeApp();

const secretManagerClient = new SecretManagerServiceClient();
const secretCache = new Map();
const PROFILE_API_MAP = {
  day: "Day",
  night: "Night",
  general: "General",
  backlight: "BackLight",
  lowlight: "LowLight",
  custom1: "Custom",
  custom2: "Custom1",
  custom3: "Custom2",
};
const IR_DEFAULT_LEVELS = {
  far: [100, 0],
  medium: [50, 50],
  near: [0, 100],
};
const DEFAULT_GLOBAL_DEST_BUCKET = "ting-vision.firebasestorage.app";
const DEFAULT_GLOBAL_LATEST_LOGO_PATH = "/logos/Latest_Sightings.png";

function createHttpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

function normalizeAccessIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const next = [];

  values.forEach((value) => {
    const cleaned = String(value || "").trim();
    if (!cleaned || seen.has(cleaned)) {
      return;
    }

    seen.add(cleaned);
    next.push(cleaned);
  });

  return next;
}

async function getAuthenticatedUserDoc(context) {
  if (!context.auth || !context.auth.uid) {
    throw createHttpsError(
        "unauthenticated",
        "You must be logged in to do that.",
    );
  }

  const userSnap = await admin.firestore()
      .collection("users")
      .doc(context.auth.uid)
      .get();

  return userSnap.exists ? userSnap.data() || {} : {};
}

async function requireAdminUser(context) {
  const userData = await getAuthenticatedUserDoc(context);
  const role = userData.role;
  if (role !== "admin") {
    throw createHttpsError(
        "permission-denied",
        "Admin access is required.",
    );
  }

  return userData;
}

async function requireCameraAccessUser(context, cameraId) {
  const userData = await getAuthenticatedUserDoc(context);
  if (userData.role === "admin") {
    return userData;
  }

  const normalizedCameraId = String(cameraId || "").trim();
  if (!normalizedCameraId) {
    throw createHttpsError("invalid-argument", "cameraId is required.");
  }

  const cameraIds = new Set(normalizeAccessIds(userData.cameraIds));
  const clientIds = new Set(normalizeAccessIds(userData.clientIds));
  const legacyLocationIds = new Set(normalizeAccessIds(userData.locationIds));

  if (cameraIds.has(normalizedCameraId) || legacyLocationIds.has(normalizedCameraId)) {
    return userData;
  }

  const cameraSnap = await admin.firestore()
      .collection("cameras")
      .doc(normalizedCameraId)
      .get();

  if (!cameraSnap.exists) {
    throw createHttpsError(
        "not-found",
        "Camera \"" + normalizedCameraId + "\" was not found.",
    );
  }

  const cameraData = cameraSnap.data() || {};
  const cameraClientId = String(
      cameraData.client_id ||
      cameraData.clientId ||
      "",
  ).trim();

  if (
    cameraClientId &&
    (clientIds.has(cameraClientId) || legacyLocationIds.has(cameraClientId))
  ) {
    return userData;
  }

  throw createHttpsError(
      "permission-denied",
      "You do not have access to that camera.",
  );
}

async function requireClientAccessUser(context, clientId) {
  const userData = await getAuthenticatedUserDoc(context);
  if (userData.role === "admin") {
    return userData;
  }

  const normalizedClientId = String(clientId || "").trim();
  if (!normalizedClientId) {
    throw createHttpsError("invalid-argument", "clientId is required.");
  }

  const clientIds = new Set(normalizeAccessIds(userData.clientIds));
  const legacyLocationIds = new Set(normalizeAccessIds(userData.locationIds));

  if (clientIds.has(normalizedClientId) || legacyLocationIds.has(normalizedClientId)) {
    return userData;
  }

  throw createHttpsError(
      "permission-denied",
      "You do not have access to that location.",
  );
}

function normalizeWhatsAppGroups(values) {
  const rawValues = Array.isArray(values) ?
    values :
    (typeof values === "string" ? values.split(/[\n,]/) : []);

  const seen = new Set();
  const next = [];

  rawValues.forEach((value) => {
    const normalizedValue = value &&
      typeof value === "object" &&
      !Array.isArray(value) ?
      value :
      {id: value};
    const id = String(
        normalizedValue.id ||
        normalizedValue.groupId ||
        normalizedValue.group_id ||
        normalizedValue.value ||
        "",
    ).trim();
    const name = String(
        normalizedValue.name ||
        normalizedValue.label ||
        "",
    ).trim();

    if (!id || seen.has(id)) {
      return;
    }

    seen.add(id);
    next.push({
      name: name || "Group " + (next.length + 1),
      id: id,
    });
  });

  return next;
}

function normalizeAlertCooldowns(rawValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  const next = {};
  Object.entries(rawValue).forEach(([speciesName, minutes]) => {
    const cleanedSpecies = String(speciesName || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
    if (!cleanedSpecies) {
      return;
    }

    if (minutes === null || minutes === undefined) {
      next[cleanedSpecies] = null;
      return;
    }

    if (typeof minutes === "string") {
      const normalizedMinutes = minutes.trim().toLowerCase();
      if (!normalizedMinutes || normalizedMinutes === "never" || normalizedMinutes === "none") {
        next[cleanedSpecies] = null;
        return;
      }
    }

    const parsedMinutes = Number(minutes);
    if (!Number.isFinite(parsedMinutes)) {
      return;
    }

    next[cleanedSpecies] = Math.max(0, Math.round(parsedMinutes));
  });

  return next;
}

function normalizeRareAnimals(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  const seen = new Set();
  const next = [];

  rawValue.forEach((speciesName) => {
    const cleanedSpecies = String(speciesName || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
    if (!cleanedSpecies || seen.has(cleanedSpecies)) {
      return;
    }

    seen.add(cleanedSpecies);
    next.push(cleanedSpecies);
  });

  return next;
}

function normalizeStoragePath(rawValue) {
  const cleanedValue = String(rawValue || "").trim();
  if (!cleanedValue) {
    return "";
  }

  return "/" + cleanedValue.replace(/^\/+/, "");
}

function normalizeBucketName(rawValue) {
  const cleanedValue = String(rawValue || "").trim();
  if (!cleanedValue) {
    return "";
  }

  if (cleanedValue.includes("/") || /\s/.test(cleanedValue)) {
    throw createHttpsError(
        "invalid-argument",
        "Enter a valid storage bucket name.",
    );
  }

  return cleanedValue;
}

function getGlobalSettingsDocRef() {
  return admin.firestore().collection("settings").doc("global");
}

function buildGlobalSettingsResponse(rawData) {
  const data = rawData && typeof rawData === "object" ? rawData : {};
  const alerts = data.alerts && typeof data.alerts === "object" &&
    !Array.isArray(data.alerts) ? data.alerts : {};
  const storage = data.storage && typeof data.storage === "object" &&
    !Array.isArray(data.storage) ? data.storage : {};
  const branding = data.branding && typeof data.branding === "object" &&
    !Array.isArray(data.branding) ? data.branding : {};

  return {
    alerts: {
      defaultAdminWhatsappGroups: normalizeWhatsAppGroups(
          alerts.defaultAdminWhatsappGroups,
      ),
    },
    storage: {
      destBucket: String(storage.destBucket || "").trim() || null,
    },
    branding: {
      latestLogoPath: normalizeStoragePath(
          branding.latestLogoPath,
      ) || null,
    },
  };
}

async function getEffectiveGlobalDestBucket() {
  const globalSettingsRef = getGlobalSettingsDocRef();
  const currentSnapshot = await ensureGlobalSettingsDocExists(globalSettingsRef);
  const currentSettings = buildGlobalSettingsResponse(
      currentSnapshot.exists ? currentSnapshot.data() || {} : {},
  );

  return currentSettings.storage.destBucket ||
    admin.app().options.storageBucket ||
    DEFAULT_GLOBAL_DEST_BUCKET;
}

async function ensureGlobalSettingsDocExists(globalSettingsRef) {
  const currentSnapshot = await globalSettingsRef.get();
  if (currentSnapshot.exists) {
    return currentSnapshot;
  }

  await globalSettingsRef.set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return globalSettingsRef.get();
}

function buildUpdatedByFields(context, userData) {
  const updatedByFields = {};
  const updatedByEmail = String(
      context?.auth?.token?.email ||
      userData?.email ||
      "",
  ).trim();

  if (context?.auth?.uid) {
    updatedByFields.updatedByUid = context.auth.uid;
  }

  if (updatedByEmail) {
    updatedByFields.updatedByEmail = updatedByEmail;
  }

  return updatedByFields;
}

function resolveProjectId() {
  return process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    admin.app().options.projectId ||
    "";
}

async function getSecret(secretId) {
  const key = String(secretId || "").trim();
  if (!key) {
    throw new Error("Secret name is required.");
  }

  if (secretCache.has(key)) {
    return secretCache.get(key);
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("Unable to resolve the GCP project ID.");
  }

  const name = key.startsWith("projects/") ?
    key :
    "projects/" + projectId + "/secrets/" + key + "/versions/latest";

  const response = await secretManagerClient.accessSecretVersion({name: name});
  const version = Array.isArray(response) ? response[0] : response;
  const payload = version &&
    version.payload &&
    version.payload.data ?
    version.payload.data.toString("utf8").trim() :
    "";

  if (!payload) {
    throw new Error("Secret \"" + key + "\" is empty.");
  }

  secretCache.set(key, payload);
  return payload;
}

function md5(value) {
  return crypto.createHash("md5").update(String(value)).digest("hex");
}

function randomHex(byteLength) {
  return crypto.randomBytes(byteLength).toString("hex");
}

function parseDigestChallenge(headerValue) {
  const header = String(headerValue || "").trim();
  if (!header.toLowerCase().startsWith("digest ")) {
    return null;
  }

  const challenge = {};
  const payload = header.slice(7);
  const pattern = /([a-z0-9_-]+)=("([^"\\]|\\.)*"|[^,]+)/gi;
  let match = pattern.exec(payload);

  while (match) {
    const key = match[1];
    let value = match[2];
    if (value.startsWith("\"") && value.endsWith("\"")) {
      value = value.slice(1, -1).replace(/\\"/g, "\"");
    }
    challenge[key] = value;
    match = pattern.exec(payload);
  }

  return challenge;
}

function buildDigestAuthorizationHeader(options) {
  const challenge = options.challenge || {};
  const method = String(options.method || "GET").toUpperCase();
  const uri = String(options.uri || "");
  const username = String(options.username || "");
  const password = String(options.password || "");
  const realm = String(challenge.realm || "");
  const nonce = String(challenge.nonce || "");
  const opaque = String(challenge.opaque || "");
  const algorithm = String(challenge.algorithm || "MD5").toUpperCase();
  const qopTokens = String(challenge.qop || "")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
  const qop = qopTokens.includes("auth") ? "auth" : qopTokens[0];
  const nc = "00000001";
  const cnonce = randomHex(16);

  if (!realm || !nonce) {
    throw new Error("Incomplete Dahua digest challenge.");
  }

  let ha1 = md5(username + ":" + realm + ":" + password);
  if (algorithm === "MD5-SESS") {
    ha1 = md5(ha1 + ":" + nonce + ":" + cnonce);
  }

  const ha2 = md5(method + ":" + uri);
  const response = qop ?
    md5(ha1 + ":" + nonce + ":" + nc + ":" +
      cnonce + ":" + qop + ":" + ha2) :
    md5(ha1 + ":" + nonce + ":" + ha2);

  const headerParts = [
    "Digest username=\"" + username + "\"",
    "realm=\"" + realm + "\"",
    "nonce=\"" + nonce + "\"",
    "uri=\"" + uri + "\"",
    "response=\"" + response + "\"",
    "algorithm=" + algorithm,
  ];

  if (opaque) {
    headerParts.push("opaque=\"" + opaque + "\"");
  }
  if (qop) {
    headerParts.push("qop=" + qop);
    headerParts.push("nc=" + nc);
    headerParts.push("cnonce=\"" + cnonce + "\"");
  }

  return headerParts.join(", ");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(function() {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function dahuaDigestRequest(url, options) {
  const username = options && options.username ? options.username : "";
  const password = options && options.password ? options.password : "";
  const method = String(options && options.method || "GET").toUpperCase();
  const timeoutMs = options && options.timeoutMs ? options.timeoutMs : 5000;
  const headers = {
    "Accept": "text/plain, */*",
    ...(options && options.headers ? options.headers : {}),
  };

  const initialResponse = await fetchWithTimeout(
      url,
      {
        method: method,
        headers: headers,
      },
      timeoutMs,
  );

  if (initialResponse.status !== 401) {
    return initialResponse;
  }

  const challengeHeader = initialResponse.headers.get("www-authenticate");
  const challenge = parseDigestChallenge(challengeHeader);
  if (!challenge) {
    throw new Error("Camera did not return a valid digest challenge.");
  }

  const parsedUrl = new URL(url);
  const uri = parsedUrl.pathname + parsedUrl.search;
  const authorization = buildDigestAuthorizationHeader({
    challenge: challenge,
    method: method,
    uri: uri,
    username: username,
    password: password,
  });

  return fetchWithTimeout(
      url,
      {
        method: method,
        headers: {
          ...headers,
          "Authorization": authorization,
        },
      },
      timeoutMs,
  );
}

async function dahuaDigestGet(url, username, password, timeoutMs) {
  return dahuaDigestRequest(url, {
    method: "GET",
    username: username,
    password: password,
    timeoutMs: timeoutMs,
  });
}

function normalizeInteger(value, fallbackValue) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallbackValue;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function buildCameraBaseUrl(cameraData) {
  const rawHost = String(
      cameraData.public_ip_address ||
      cameraData.private_ip_address ||
      "",
  ).trim();

  if (!rawHost) {
    throw new Error(
        "Camera must have a public or private IP before presets can load.",
    );
  }

  const httpPort = normalizeInteger(cameraData.ptz_http_port, 80);
  if (/^https?:\/\//i.test(rawHost)) {
    const parsedUrl = new URL(rawHost);
    if (!parsedUrl.port) {
      parsedUrl.port = String(httpPort);
    }
    return parsedUrl.protocol + "//" + parsedUrl.host;
  }

  const protocol = httpPort === 443 ? "https" : "http";
  return protocol + "://" + rawHost + ":" + httpPort;
}

function buildCameraUrl(cameraData, path, params) {
  const baseUrl = buildCameraBaseUrl(cameraData);
  const search = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    search.append(key, String(value));
  });

  const query = search.toString();
  if (!query) {
    return baseUrl + path;
  }

  return baseUrl + path + "?" + query;
}

function parsePresetListResponse(bodyText) {
  const presetsByRow = new Map();
  const lines = String(bodyText || "").split(/\r?\n/);
  const pattern = /^(?:presets|table\.Preset)\[(\d+)\]\.([^=]+)=(.*)$/i;

  lines.forEach(function(rawLine) {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    const match = line.match(pattern);
    if (!match) {
      return;
    }

    const rowKey = match[1];
    const fieldKey = match[2];
    const fieldValue = match[3].trim();

    if (!presetsByRow.has(rowKey)) {
      presetsByRow.set(rowKey, {});
    }

    presetsByRow.get(rowKey)[fieldKey] = fieldValue;
  });

  return Array.from(presetsByRow.values())
      .map(function(entry) {
        const backendId = normalizeInteger(
            entry.Index || entry.index || entry.Id || entry.ID,
            NaN,
        );

        if (!Number.isFinite(backendId)) {
          return null;
        }

        return {
          backend_id: backendId,
          name: String(entry.Name || entry.name || "").trim(),
        };
      })
      .filter(Boolean)
      .sort(function(left, right) {
        return left.backend_id - right.backend_id;
      });
}

function parseKeyValueBody(bodyText) {
  const result = {};

  String(bodyText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) {
          return;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (key) {
          result[key] = value;
        }
      });

  return result;
}

function defaultPresetProfileForWhenIsActive(whenIsActive) {
  const normalized = String(whenIsActive || "").trim().toLowerCase();

  if (normalized.startsWith("day")) {
    return "Day";
  }

  if (normalized.startsWith("night")) {
    return "Custom1";
  }

  return "";
}

function normalizePresetWhenIsActive(whenIsActive) {
  const rawValue = String(whenIsActive || "").trim();
  const normalized = rawValue.toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("day")) {
    return "Day";
  }

  if (normalized.startsWith("night")) {
    return "Night";
  }

  if (normalized === "never") {
    return "NEVER";
  }

  if (
    normalized === "both" ||
    normalized === "always" ||
    normalized === "all" ||
    normalized === "any" ||
    normalized === "24x7" ||
    normalized === "24/7" ||
    normalized === "nightandday" ||
    normalized === "dayandnight"
  ) {
    return "NightAndDay";
  }

  return rawValue;
}

function normalizePresetSideOfCamera(sideOfCamera) {
  const normalized = String(sideOfCamera || "").trim();

  if (normalized === "far_left") {
    return "far left";
  }

  if (normalized === "far_right") {
    return "far right";
  }

  return normalized;
}

function compactObject(value) {
  return Object.entries(value || {}).reduce((acc, entry) => {
    const key = entry[0];
    const fieldValue = entry[1];

    if (fieldValue !== undefined) {
      acc[key] = fieldValue;
    }

    return acc;
  }, {});
}

function getStatusPresetId(status) {
  const keys = [
    "status.PresetID",
    "PresetID",
    "status.ActionID",
    "ActionID",
  ];

  for (const key of keys) {
    if (!(key in (status || {}))) {
      continue;
    }

    const parsed = normalizeInteger(status[key], NaN);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function statusValueIsIdle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "idle" ||
    normalized === "stop" ||
    normalized === "stopped";
}

function getStatusIdleState(status) {
  const hardIdleKeys = [
    "status.MoveStatus",
    "status.PanTiltStatus",
    "status.ZoomStatus",
  ];
  const presentKeys = hardIdleKeys.filter((key) => key in (status || {}));

  if (presentKeys.length === 0) {
    return null;
  }

  return presentKeys.every((key) => statusValueIsIdle(status[key]));
}

async function sendGotoPreset(cameraData, username, password, presetId) {
  const channel = normalizeInteger(cameraData.ptz_channel, 1);
  const baseUrl = buildCameraBaseUrl(cameraData);
  const query = new URLSearchParams({
    action: "start",
    channel: String(channel),
    code: "GotoPreset",
    arg1: "0",
    arg2: String(presetId),
    arg3: "0",
  });
  const requestUrl = baseUrl + "/cgi-bin/ptz.cgi?" + query.toString();

  const response = await dahuaDigestGet(
      requestUrl,
      username,
      password,
      5000,
  );
  const bodyText = String(await response.text() || "").trim();

  if (!response.ok) {
    throw new Error(
        "Camera preset move failed with HTTP " + response.status + ".",
    );
  }

  if (bodyText && !/^OK\b/i.test(bodyText)) {
    throw new Error(
        "Camera rejected the move to preset " + presetId + ": " + bodyText,
    );
  }
}

async function getCameraStatus(cameraData, username, password) {
  const channel = normalizeInteger(cameraData.ptz_channel, 1);
  const baseUrl = buildCameraBaseUrl(cameraData);
  const query = new URLSearchParams({
    action: "getStatus",
    channel: String(channel),
  });
  const requestUrl = baseUrl + "/cgi-bin/ptz.cgi?" + query.toString();

  const response = await dahuaDigestGet(
      requestUrl,
      username,
      password,
      5000,
  );
  const bodyText = String(await response.text() || "").trim();

  if (!response.ok) {
    throw new Error(
        "Camera status request failed with HTTP " + response.status + ".",
    );
  }

  return parseKeyValueBody(bodyText);
}

async function moveCameraToPresetBeforeRename(
    cameraData,
    username,
    password,
    presetId,
) {
  const settleSec = Number(cameraData.PRESET_MOVE_SETTLE_SEC);
  const minimumInitialDelayMs = 1200;
  const pollIntervalMs = 500;
  const timeoutMs = 15000;
  const fallbackSettleMs = Number.isFinite(settleSec) ?
    Math.max(minimumInitialDelayMs, settleSec * 1000) :
    5000;

  await sendGotoPreset(cameraData, username, password, presetId);
  await delay(minimumInitialDelayMs);

  const startedAt = Date.now();
  let lastStatusError = null;

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const status = await getCameraStatus(cameraData, username, password);
      const currentPresetId = getStatusPresetId(status);
      const idleState = getStatusIdleState(status);
      const presetMatches = currentPresetId === presetId;

      if (presetMatches && idleState !== false) {
        return;
      }
    } catch (error) {
      lastStatusError = error;
    }

    await delay(pollIntervalMs);
  }

  if (lastStatusError) {
    await delay(fallbackSettleMs);
    return;
  }

  throw new Error(
      "Timed out waiting for the camera to arrive at preset " + presetId + ".",
  );
}

function normalizeImportedPreset(sourcePreset, existingPreset) {
  const current = existingPreset || {};
  const backendId = normalizeInteger(sourcePreset.backend_id, NaN);
  const currentDistance = Number(current.distance_m);
  const whenIsActive = normalizePresetWhenIsActive(
      current.whenIsActive || current.when_is_active || "NightAndDay",
  ) || "NightAndDay";
  const profileValue = String(
      current.profile ||
      current.dayProfile ||
      current.day_profile ||
      current.nightProfile ||
      current.night_profile ||
      defaultPresetProfileForWhenIsActive(whenIsActive),
  ).trim() || undefined;
  const nextPreset = compactObject({
    backendId: backendId,
    name: String(current.name || sourcePreset.name || "").trim() ||
      "Preset " + backendId,
    whenIsActive: whenIsActive,
    spotter: String(current.spotter || "motion").trim() || "motion",
    enabled: current.enabled !== false,
    side_of_camera:
      normalizePresetSideOfCamera(current.side_of_camera) || undefined,
    side_of_river: String(current.side_of_river || "").trim() || undefined,
    profile: profileValue,
    irDistance: String(current.irDistance || "").trim() || undefined,
    infraredDistance:
      String(current.infraredDistance || "").trim() || undefined,
  });

  if (Number.isFinite(currentDistance)) {
    nextPreset.distance_m = currentDistance;
  }

  return nextPreset;
}

function toCameraPresetConfigList(presetMap) {
  return Array.from(presetMap.values())
      .map((preset) => {
        const whenIsActive = normalizePresetWhenIsActive(
            preset.whenIsActive || preset.when_is_active || "NightAndDay",
        ) || "NightAndDay";
        const profileValue = String(
            preset.profile ||
            preset.dayProfile ||
            preset.day_profile ||
            preset.nightProfile ||
            preset.night_profile ||
            defaultPresetProfileForWhenIsActive(whenIsActive),
        ).trim() || undefined;
        const nextPreset = compactObject({
          backendId: normalizeInteger(
              preset.backendId || preset.backend_id,
              NaN,
          ),
          name: String(preset.name || "").trim(),
          whenIsActive: whenIsActive,
          spotter: String(preset.spotter || "motion").trim() || "motion",
          enabled: preset.enabled !== false,
          side_of_camera:
            normalizePresetSideOfCamera(preset.side_of_camera) || undefined,
          side_of_river:
            String(preset.side_of_river || "").trim() || undefined,
          profile: profileValue,
          irDistance: String(preset.irDistance || "").trim() || undefined,
          infraredDistance: String(
              preset.infraredDistance || "",
          ).trim() || undefined,
        });

        const distance = Number(preset.distance_m);
        if (Number.isFinite(distance)) {
          nextPreset.distance_m = distance;
        }

        return nextPreset;
      })
      .filter((preset) => Number.isFinite(preset.backendId))
      .sort((left, right) => left.backendId - right.backendId);
}

async function fetchCameraPresetPayload(cameraData) {
  const username = await getSecret("dahua_username");
  const password = await getSecret("dahua_password");
  const channel = normalizeInteger(cameraData.ptz_channel, 1);
  const baseUrl = buildCameraBaseUrl(cameraData);
  const requestUrl = baseUrl +
    "/cgi-bin/ptz.cgi?action=getPresets&channel=" +
    encodeURIComponent(String(channel));

  const response = await dahuaDigestGet(
      requestUrl,
      username,
      password,
      5000,
  );

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
        "Camera preset request failed with HTTP " + response.status + ".",
    );
  }

  return parsePresetListResponse(bodyText);
}

async function renameCameraPresetOnDevice(cameraData, presetId, presetName) {
  const username = await getSecret("dahua_username");
  const password = await getSecret("dahua_password");
  const channel = normalizeInteger(cameraData.ptz_channel, 1);
  const backendId = normalizeInteger(presetId, NaN);
  const nextName = String(presetName || "").trim();

  if (!Number.isFinite(backendId)) {
    throw new Error("A valid preset ID is required.");
  }

  if (!nextName) {
    throw new Error("Preset name is required.");
  }

  const baseUrl = buildCameraBaseUrl(cameraData);
  await moveCameraToPresetBeforeRename(
      cameraData,
      username,
      password,
      backendId,
  );
  const query = new URLSearchParams({
    action: "setPreset",
    channel: String(channel),
    arg1: String(backendId),
    arg2: nextName,
  });
  const requestUrl = baseUrl + "/cgi-bin/ptz.cgi?" + query.toString();

  const response = await dahuaDigestGet(
      requestUrl,
      username,
      password,
      5000,
  );

  const bodyText = String(await response.text() || "").trim();
  if (!response.ok) {
    throw new Error(
        "Camera preset rename failed with HTTP " + response.status + ".",
    );
  }

  if (bodyText && !/^OK\b/i.test(bodyText)) {
    throw new Error(
        "Camera rejected the preset rename: " + bodyText,
    );
  }

  return {
    backend_id: backendId,
    name: nextName,
  };
}

function normalizeDahuaApiVersion(cameraData) {
  return String(cameraData.dahua_api_version || "v1")
      .trim()
      .toLowerCase();
}

function clampPercent(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(0, Math.min(Math.round(parsed), 100));
}

function toProfileApiValue(profileName) {
  const requestedProfile = String(profileName || "").trim();
  if (!requestedProfile) {
    return "";
  }

  const normalized = requestedProfile.toLowerCase();
  return PROFILE_API_MAP[normalized] || requestedProfile;
}

async function setCameraConfig(cameraData, username, password, params) {
  const requestUrl = buildCameraUrl(
      cameraData,
      "/cgi-bin/configManager.cgi",
      {
        action: "setConfig",
        ...(params || {}),
      },
  );
  const response = await dahuaDigestGet(
      requestUrl,
      username,
      password,
      5000,
  );
  const bodyText = String(await response.text() || "").trim();

  if (!response.ok) {
    throw new Error(
        "Camera config request failed with HTTP " + response.status + ".",
    );
  }

  if (bodyText && !/^OK\b/i.test(bodyText)) {
    throw new Error("Camera rejected the config update: " + bodyText);
  }
}

async function setSceneProfileOnDevice(
    cameraData,
    username,
    password,
    profileName,
) {
  const requestedProfile = String(profileName || "").trim();
  const apiProfile = toProfileApiValue(requestedProfile);

  if (!apiProfile) {
    throw new Error("Profile is required.");
  }

  await setCameraConfig(
      cameraData,
      username,
      password,
      {
        "VideoInMode[0].Mode": 4,
        "VideoInMode[0].ConfigEx": apiProfile,
      },
  );

  return {
    requestedProfile: requestedProfile,
    appliedProfile: apiProfile,
  };
}

function buildLightingV2Params(options) {
  const params = {};
  for (let idx = 0; idx < 9; idx += 1) {
    const base = "Lighting_V2[0][" + idx + "][0]";
    if (options.mode !== undefined) {
      params[base + ".Mode"] = String(options.mode);
    }
    if (options.correction !== undefined) {
      params[base + ".Correction"] = String(options.correction);
    }
    if (options.farLight !== undefined) {
      params[base + ".FarLight[0].Light"] = String(options.farLight);
    }
    if (options.nearLight !== undefined) {
      params[base + ".NearLight[0].Light"] = String(options.nearLight);
    }
  }
  return params;
}

async function setInfraredLevelOnDevice(
    cameraData,
    username,
    password,
    level,
) {
  const nextLevel = clampPercent(level, 100);
  await setCameraConfig(
      cameraData,
      username,
      password,
      {
        "VideoInOptions[0].InfraRedLevel": nextLevel,
      },
  );

  return {
    irMode: "level",
    irSummary: "IR level " + nextLevel,
  };
}

async function setInfraredByVersionOnDevice(
    cameraData,
    username,
    password,
    level,
) {
  const nextLevel = clampPercent(level, 100);
  const apiVersion = normalizeDahuaApiVersion(cameraData);

  if (apiVersion === "v2") {
    return setInfraredLevelOnDevice(
        cameraData,
        username,
        password,
        nextLevel,
    );
  }

  await setIrManualOnDevice(
      cameraData,
      username,
      password,
      nextLevel,
      nextLevel,
  );

  return {
    irMode: "manual",
    irSummary: "IR level " + nextLevel + " (mapped to manual for v1)",
  };
}

async function setIrManualOnDevice(
    cameraData,
    username,
    password,
    farLight,
    nearLight,
) {
  const far = clampPercent(farLight, 0);
  const near = clampPercent(nearLight, 0);
  const apiVersion = normalizeDahuaApiVersion(cameraData);

  if (apiVersion === "v2") {
    await setCameraConfig(
        cameraData,
        username,
        password,
        buildLightingV2Params({
          mode: "Manual",
          farLight: far,
          nearLight: near,
        }),
    );
  } else {
    await setCameraConfig(
        cameraData,
        username,
        password,
        {
          "Lighting[0][0].Mode": "Manual",
          "Lighting[0][0].FarLight[0].Light": far,
          "Lighting[0][0].NearLight[0].Light": near,
        },
    );
  }

  return {
    irMode: "manual",
    irSummary: "IR manual far " + far + ", near " + near,
  };
}

async function setIrZoomPriorityOnDevice(
    cameraData,
    username,
    password,
    correction,
) {
  const nextCorrection = clampPercent(correction, 50);
  const apiVersion = normalizeDahuaApiVersion(cameraData);

  if (apiVersion === "v2") {
    await setCameraConfig(
        cameraData,
        username,
        password,
        buildLightingV2Params({
          mode: "ZoomPrio",
          correction: nextCorrection,
          farLight: 0,
          nearLight: 50,
        }),
    );
  } else {
    await setCameraConfig(
        cameraData,
        username,
        password,
        {
          "Lighting[0][0].Mode": "ZoomPrio",
          "Lighting[0][0].Correction": nextCorrection,
        },
    );
  }

  return {
    irMode: "zoom",
    irSummary: "IR zoom priority " + nextCorrection,
  };
}

function parseInfraredControlValue(rawValue) {
  const requestedValue = String(rawValue || "").trim();
  const normalizedValue = requestedValue.toLowerCase().replace(/\s+/g, "");

  if (!normalizedValue) {
    throw new Error("IR value is required.");
  }

  if (/^\d{1,3}$/.test(normalizedValue)) {
    return {
      kind: "level",
      level: clampPercent(normalizedValue, 100),
      requestedValue: requestedValue,
    };
  }

  const manualMatch = normalizedValue.match(/^(far|near|medium)(\d{1,3})$/);
  if (manualMatch) {
    const base = manualMatch[1];
    const value = clampPercent(manualMatch[2], 50);
    if (base === "far") {
      return {
        kind: "manual",
        farLight: value,
        nearLight: 0,
        requestedValue: requestedValue,
      };
    }

    if (base === "near") {
      return {
        kind: "manual",
        farLight: 0,
        nearLight: value,
        requestedValue: requestedValue,
      };
    }

    return {
      kind: "manual",
      farLight: value,
      nearLight: value,
      requestedValue: requestedValue,
    };
  }

  if (normalizedValue in IR_DEFAULT_LEVELS) {
    const [farLight, nearLight] = IR_DEFAULT_LEVELS[normalizedValue];
    return {
      kind: "manual",
      farLight: farLight,
      nearLight: nearLight,
      requestedValue: requestedValue,
    };
  }

  if (normalizedValue.startsWith("zoom")) {
    const correctionMatch = normalizedValue.match(/(\d{1,3})/);
    return {
      kind: "zoom",
      correction: clampPercent(
          correctionMatch ? correctionMatch[1] : 50,
          50,
      ),
      requestedValue: requestedValue,
    };
  }

  throw new Error(
      "IR value must look like 70, far100, medium50, near80, or zoom30.",
  );
}

async function applyInfraredControlOnDevice(
    cameraData,
    username,
    password,
    rawValue,
) {
  const controlValue = parseInfraredControlValue(rawValue);

  if (controlValue.kind === "level") {
    return {
      requestedValue: controlValue.requestedValue,
      ...(await setInfraredByVersionOnDevice(
          cameraData,
          username,
          password,
          controlValue.level,
      )),
    };
  }

  if (controlValue.kind === "zoom") {
    return {
      requestedValue: controlValue.requestedValue,
      ...(await setIrZoomPriorityOnDevice(
          cameraData,
          username,
          password,
          controlValue.correction,
      )),
    };
  }

  return {
    requestedValue: controlValue.requestedValue,
    ...(await setIrManualOnDevice(
        cameraData,
        username,
        password,
        controlValue.farLight,
        controlValue.nearLight,
    )),
  };
}

async function triggerWiperOnceOnDevice(cameraData, username, password) {
  const channel = normalizeInteger(cameraData.ptz_channel, 1);
  const requestUrl = buildCameraUrl(
      cameraData,
      "/cgi-bin/rainBrush.cgi",
      {
        action: "moveOnce",
        channel: channel,
      },
  );
  const response = await dahuaDigestGet(
      requestUrl,
      username,
      password,
      5000,
  );
  const bodyText = String(await response.text() || "").trim();

  if (!response.ok) {
    throw new Error(
        "Camera wiper request failed with HTTP " + response.status + ".",
    );
  }

  if (bodyText && !/^OK\b/i.test(bodyText)) {
    throw new Error("Camera rejected the wiper command: " + bodyText);
  }

  return {
    action: "moveOnce",
    channel: channel,
    transport: "cgi",
  };
}

exports.addPagesToUser = functions.https.onCall(async (data, context) => {
  console.log("Version 1.0.12");
  const accessToken = data.accessToken;
  const uid = context.auth.uid;
  console.log("uid", uid);
  let url = "https://graph.facebook.com/v15.0/me/accounts" +
    "?fields=access_token,name,picture,id&access_token=" + accessToken;
  const allPages = [];

  while (url) {
    const res = await fetch(url, {
      method: "GET",
      headers: {"Content-Type": "application/json"},
    });
    const json = await res.json();
    if (json.data) {
      allPages.push(...json.data);
    }
    url = json.paging && json.paging.next ? json.paging.next : null;
  }

  for (const page of allPages) {
    const pageId = page.id;
    const pageName = page.name;
    await admin.firestore()
        .collection("users")
        .doc(uid)
        .collection("pages")
        .doc(pageId)
        .set({
          id: pageId,
          name: pageName,
          link: "https://www.facebook.com/" + pageId,
          picture: page.picture.data.url,
        });
  }

  const pages = [];
  await admin.firestore()
      .collection("users")
      .doc(uid)
      .collection("pages")
      .get()
      .then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
          pages.push(doc.id);
        });
      });
  const pagesToRemove = pages.filter((page) =>
    !allPages.some((existingPage) => existingPage.id === page));
  for (const page of pagesToRemove) {
    await admin.firestore()
        .collection("users")
        .doc(uid)
        .collection("pages")
        .doc(page)
        .delete();
  }

  return true;
});

exports.getPagesFromUser = functions.https.onCall(async (data, context) => {
  console.log("Version 1.0.3");

  if (!context.auth) {
    throw createHttpsError(
        "permission-denied",
        "You must be logged in to get your pages",
    );
  }

  const uid = context.auth.uid;

  console.log("uid", uid);
  const pages = [];
  await admin.firestore()
      .collection("users")
      .doc(uid)
      .collection("pages")
      .get()
      .then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
          console.log("doc", doc.data());
          pages.push(doc.data());
        });
        console.log("pages", pages);
      });
  return pages;
});

exports.importCameraPresets = functions.https.onCall(
    async (data, context) => {
      await requireAdminUser(context);

      const cameraId = String(data && data.cameraId || "").trim();
      if (!cameraId) {
        throw createHttpsError(
            "invalid-argument",
            "cameraId is required.",
        );
      }

      const cameraRef = admin.firestore().collection("cameras").doc(cameraId);
      const cameraSnap = await cameraRef.get();
      if (!cameraSnap.exists) {
        throw createHttpsError(
            "not-found",
            "Camera \"" + cameraId + "\" was not found.",
        );
      }

      try {
        const cameraData = cameraSnap.data() || {};
        const importedPresets = await fetchCameraPresetPayload(cameraData);
        const presetCollection = cameraRef.collection("presets");
        const existingSnap = await presetCollection.get();
        const existingMap = new Map();
        const mergedPresetMap = new Map();

        existingSnap.forEach((docSnap) => {
          existingMap.set(docSnap.id, docSnap.data() || {});
          mergedPresetMap.set(docSnap.id, docSnap.data() || {});
        });

        const batch = admin.firestore().batch();
        const firestorePresets = [];
        let createdCount = 0;
        let updatedCount = 0;

        importedPresets.forEach((sourcePreset) => {
          const presetId = String(sourcePreset.backend_id);
          const existingPreset = existingMap.get(presetId) || {};
          const normalized = normalizeImportedPreset(
              sourcePreset,
              existingPreset,
          );

          if (existingMap.has(presetId)) {
            updatedCount += 1;
          } else {
            createdCount += 1;
          }

          batch.set(
              presetCollection.doc(presetId),
              {
                ...normalized,
                createdAt: existingPreset.createdAt ||
                  admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true},
          );

          firestorePresets.push({
            id: presetId,
            ...normalized,
          });
          mergedPresetMap.set(presetId, normalized);
        });

        const mergedPresetList = toCameraPresetConfigList(mergedPresetMap);

        batch.set(
            cameraRef,
            {
              PTZ_PRESETS: mergedPresetList,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true},
        );

        await batch.commit();

        return {
          cameraId: cameraId,
          createdCount: createdCount,
          importedCount: firestorePresets.length,
          presets: mergedPresetList.map((preset) => ({
            id: String(preset.backendId),
            ...preset,
          })),
          updatedCount: updatedCount,
        };
      } catch (error) {
        console.error("Failed to import presets", error);
        throw createHttpsError(
            "internal",
            error && error.message ?
              error.message :
              "Unable to import presets from the camera.",
        );
      }
    },
);

exports.renameCameraPreset = functions.https.onCall(
    async (data, context) => {
      await requireAdminUser(context);

      const cameraId = String(data && data.cameraId || "").trim();
      const presetId = normalizeInteger(data && data.presetId, NaN);
      const presetName = String(data && data.name || "").trim();

      if (!cameraId) {
        throw createHttpsError(
            "invalid-argument",
            "cameraId is required.",
        );
      }

      if (!Number.isFinite(presetId)) {
        throw createHttpsError(
            "invalid-argument",
            "presetId must be a number.",
        );
      }

      if (!presetName) {
        throw createHttpsError(
            "invalid-argument",
            "name is required.",
        );
      }

      const cameraRef = admin.firestore().collection("cameras").doc(cameraId);
      const cameraSnap = await cameraRef.get();
      if (!cameraSnap.exists) {
        throw createHttpsError(
            "not-found",
            "Camera \"" + cameraId + "\" was not found.",
        );
      }

      try {
        const result = await renameCameraPresetOnDevice(
            cameraSnap.data() || {},
            presetId,
            presetName,
        );

        return {
          cameraId: cameraId,
          presetId: result.backend_id,
          name: result.name,
          ok: true,
        };
      } catch (error) {
        console.error("Failed to rename preset on camera", error);
        throw createHttpsError(
            "internal",
            error && error.message ?
              error.message :
              "Unable to rename the preset on the camera.",
        );
      }
    },
);

exports.cameraQuickControl = functions.https.onCall(
    async (data, context) => {
      const cameraId = String(data && data.cameraId || "").trim();
      const control = String(data && data.control || "")
          .trim()
          .toLowerCase();

      if (!cameraId) {
        throw createHttpsError(
            "invalid-argument",
            "cameraId is required.",
        );
      }

      if (!control) {
        throw createHttpsError(
            "invalid-argument",
            "control is required.",
        );
      }

      await requireCameraAccessUser(context, cameraId);

      const cameraRef = admin.firestore().collection("cameras").doc(cameraId);
      const cameraSnap = await cameraRef.get();
      if (!cameraSnap.exists) {
        throw createHttpsError(
            "not-found",
            "Camera \"" + cameraId + "\" was not found.",
        );
      }

      try {
        const cameraData = cameraSnap.data() || {};
        const username = await getSecret("dahua_username");
        const password = await getSecret("dahua_password");

        if (control === "wiper") {
          const result = await triggerWiperOnceOnDevice(
              cameraData,
              username,
              password,
          );

          return {
            cameraId: cameraId,
            control: control,
            ...result,
          };
        }

        if (control === "profile") {
          const profile = String(
              data && (data.profile || data.value) || "",
          ).trim();
          if (!profile) {
            throw createHttpsError(
                "invalid-argument",
                "profile is required.",
            );
          }

          const result = await setSceneProfileOnDevice(
              cameraData,
              username,
              password,
              profile,
          );

          return {
            cameraId: cameraId,
            control: control,
            ...result,
          };
        }

        if (control === "ir") {
          const irValue = String(
              data && (data.irValue || data.value) || "",
          ).trim();
          if (!irValue) {
            throw createHttpsError(
                "invalid-argument",
                "irValue is required.",
            );
          }

          const result = await applyInfraredControlOnDevice(
              cameraData,
              username,
              password,
              irValue,
          );

          return {
            cameraId: cameraId,
            control: control,
            ...result,
          };
        }

        throw createHttpsError(
            "invalid-argument",
            "Unsupported quick control \"" + control + "\".",
        );
      } catch (error) {
        console.error("Failed to run camera quick control", error);
        throw createHttpsError(
            "internal",
            error && error.message ?
              error.message :
              "Unable to run the camera quick control.",
        );
      }
    },
);

exports.saveClientAlertSettings = functions.https.onCall(
    async (data, context) => {
      const clientId = String(data && data.clientId || "").trim();
      if (!clientId) {
        throw createHttpsError(
            "invalid-argument",
            "clientId is required.",
        );
      }

      const userData = await requireClientAccessUser(context, clientId);

      const clientUpdates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const livestreamUrl = String(
          data && data.livestreamUrl || "",
      ).trim();
      if (livestreamUrl) {
        clientUpdates["alerts.livestreamUrl"] = livestreamUrl;
      } else {
        clientUpdates["alerts.livestreamUrl"] = admin.firestore.FieldValue.delete();
      }

      clientUpdates["alerts.includePresetDirections"] = data &&
        Object.prototype.hasOwnProperty.call(data, "includePresetDirections") ?
        Boolean(data.includePresetDirections) :
        true;

      const lodgeWhatsappGroups = normalizeWhatsAppGroups(
          data && data.lodgeWhatsappGroups,
      );
      if (lodgeWhatsappGroups.length > 0) {
        clientUpdates["alerts.lodgeWhatsappGroups"] = lodgeWhatsappGroups;
      } else {
        clientUpdates["alerts.lodgeWhatsappGroups"] = admin.firestore.FieldValue.delete();
      }

      const alertCooldowns = normalizeAlertCooldowns(
          data && data.alertCooldowns,
      );
      if (Object.keys(alertCooldowns).length > 0) {
        clientUpdates["alerts.alertCooldowns"] = alertCooldowns;
      } else {
        clientUpdates["alerts.alertCooldowns"] = admin.firestore.FieldValue.delete();
      }

      const clientRef = admin.firestore().collection("clients").doc(clientId);
      const currentClientSnap = await clientRef.get();
      const currentAlerts = currentClientSnap.exists &&
        currentClientSnap.data() &&
        typeof currentClientSnap.data().alerts === "object" &&
        !Array.isArray(currentClientSnap.data().alerts) ?
        currentClientSnap.data().alerts :
        {};
      const currentLodgeLogoPath = normalizeStoragePath(
          currentAlerts.lodgeLogoPath,
      ) || null;

      let rareAnimals = Array.isArray(currentAlerts.rareAnimals) ?
        normalizeRareAnimals(currentAlerts.rareAnimals) :
        [];
      if (
        userData.role === "admin" &&
        data &&
        Object.prototype.hasOwnProperty.call(data, "rareAnimals")
      ) {
        rareAnimals = normalizeRareAnimals(data.rareAnimals);
        clientUpdates["alerts.rareAnimals"] = rareAnimals;
      }

      const effectiveBucket = await getEffectiveGlobalDestBucket();
      await clientRef.update(clientUpdates);

      return {
        clientId: clientId,
        alerts: {
          livestreamUrl: livestreamUrl || null,
          lodgeLogoPath: currentLodgeLogoPath,
          includePresetDirections: clientUpdates["alerts.includePresetDirections"],
          lodgeWhatsappGroups: lodgeWhatsappGroups,
          alertCooldowns: alertCooldowns,
          rareAnimals: rareAnimals,
        },
        storage: {
          destBucket: effectiveBucket,
        },
      };
    },
);

exports.saveGlobalSettings = functions.https.onCall(
    async (data, context) => {
      const userData = await requireAdminUser(context);
      const globalSettingsRef = getGlobalSettingsDocRef();
      const currentSnapshot = await ensureGlobalSettingsDocExists(globalSettingsRef);
      const currentSettings = buildGlobalSettingsResponse(
          currentSnapshot.exists ? currentSnapshot.data() || {} : {},
      );

      const defaultAdminWhatsappGroups = normalizeWhatsAppGroups(
          data && data.defaultAdminWhatsappGroups,
      );
      const destBucket = normalizeBucketName(
          data && data.destBucket,
      );

      const updates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...buildUpdatedByFields(context, userData),
      };

      if (defaultAdminWhatsappGroups.length > 0) {
        updates["alerts.defaultAdminWhatsappGroups"] = defaultAdminWhatsappGroups;
      } else {
        updates["alerts.defaultAdminWhatsappGroups"] = admin.firestore.FieldValue.delete();
      }

      if (destBucket) {
        updates["storage.destBucket"] = destBucket;
      } else {
        updates["storage.destBucket"] = admin.firestore.FieldValue.delete();
      }

      await globalSettingsRef.update(updates);

      return {
        settings: {
          alerts: {
            defaultAdminWhatsappGroups: defaultAdminWhatsappGroups,
          },
          storage: {
            destBucket: destBucket || null,
          },
          branding: {
            latestLogoPath: currentSettings.branding.latestLogoPath || null,
          },
        },
      };
    },
);

exports.uploadGlobalLatestLogo = functions.https.onCall(
    async (data, context) => {
      const userData = await requireAdminUser(context);
      const rawDataUrl = String(data && data.dataUrl || "").trim();
      if (!rawDataUrl) {
        throw createHttpsError(
            "invalid-argument",
            "dataUrl is required.",
        );
      }

      const match = rawDataUrl.match(
          /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\n\r]+)$/,
      );
      if (!match) {
        throw createHttpsError(
            "invalid-argument",
            "Upload a PNG, JPEG, or WebP image.",
        );
      }

      const contentType = match[1];
      const base64Payload = match[2].replace(/\s+/g, "");
      const imageBuffer = Buffer.from(base64Payload, "base64");
      if (!imageBuffer.length) {
        throw createHttpsError(
            "invalid-argument",
            "The uploaded image was empty.",
        );
      }

      if (imageBuffer.length > 5 * 1024 * 1024) {
        throw createHttpsError(
            "invalid-argument",
            "Keep the uploaded image under 5 MB.",
        );
      }

      const globalSettingsRef = getGlobalSettingsDocRef();
      const currentSnapshot = await ensureGlobalSettingsDocExists(globalSettingsRef);
      const currentSettings = buildGlobalSettingsResponse(
          currentSnapshot.exists ? currentSnapshot.data() || {} : {},
      );
      const requestedBucket = normalizeBucketName(
          data && data.destBucket,
      );
      const effectiveBucket = requestedBucket ||
        currentSettings.storage.destBucket ||
        admin.app().options.storageBucket ||
        DEFAULT_GLOBAL_DEST_BUCKET;

      const extension = ({
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      })[contentType] || "png";
      const storagePath = "logos/global/latest-sightings-" + Date.now() + "." + extension;

      await admin.storage().bucket(effectiveBucket).file(storagePath).save(
          imageBuffer,
          {
            resumable: false,
            metadata: {
              contentType: contentType,
              cacheControl: "public,max-age=3600",
            },
          },
      );

      const latestLogoPath = "/" + storagePath;
      const updates = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...buildUpdatedByFields(context, userData),
        "branding.latestLogoPath": latestLogoPath,
        "storage.destBucket": effectiveBucket,
      };

      await globalSettingsRef.update(updates);

      return {
        settings: {
          alerts: {
            defaultAdminWhatsappGroups: currentSettings.alerts.defaultAdminWhatsappGroups,
          },
          storage: {
            destBucket: effectiveBucket,
          },
          branding: {
            latestLogoPath: latestLogoPath,
          },
        },
      };
    },
);

exports.uploadClientLodgeLogo = functions.https.onCall(
    async (data, context) => {
      const clientId = String(data && data.clientId || "").trim();
      if (!clientId) {
        throw createHttpsError(
            "invalid-argument",
            "clientId is required.",
        );
      }

      const userData = await requireClientAccessUser(context, clientId);
      const rawDataUrl = String(data && data.dataUrl || "").trim();
      if (!rawDataUrl) {
        throw createHttpsError(
            "invalid-argument",
            "dataUrl is required.",
        );
      }

      const match = rawDataUrl.match(
          /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\n\r]+)$/,
      );
      if (!match) {
        throw createHttpsError(
            "invalid-argument",
            "Upload a PNG, JPEG, or WebP image.",
        );
      }

      const contentType = match[1];
      const base64Payload = match[2].replace(/\s+/g, "");
      const imageBuffer = Buffer.from(base64Payload, "base64");
      if (!imageBuffer.length) {
        throw createHttpsError(
            "invalid-argument",
            "The uploaded image was empty.",
        );
      }

      if (imageBuffer.length > 5 * 1024 * 1024) {
        throw createHttpsError(
            "invalid-argument",
            "Keep the uploaded image under 5 MB.",
        );
      }

      const effectiveBucket = await getEffectiveGlobalDestBucket();
      const extension = ({
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      })[contentType] || "png";
      const storagePath = "logo/" + clientId + "." + extension;

      await admin.storage().bucket(effectiveBucket).file(storagePath).save(
          imageBuffer,
          {
            resumable: false,
            metadata: {
              contentType: contentType,
              // The path is stable now, so avoid long-lived stale logo caching.
              cacheControl: "no-cache",
            },
          },
      );

      const lodgeLogoPath = "/" + storagePath;
      const clientRef = admin.firestore().collection("clients").doc(clientId);
      await clientRef.update({
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...buildUpdatedByFields(context, userData),
        "alerts.lodgeLogoPath": lodgeLogoPath,
      });

      return {
        clientId: clientId,
        alerts: {
          lodgeLogoPath: lodgeLogoPath,
        },
        storage: {
          destBucket: effectiveBucket,
        },
      };
    },
);
