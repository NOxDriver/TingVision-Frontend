import React, {
  useDeferredValue,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import {
  FiCamera,
  FiGlobe,
  FiPlusCircle,
  FiRefreshCw,
  FiSave,
  FiSettings,
  FiShield,
  FiUploadCloud,
  FiUsers,
} from 'react-icons/fi';
import { db, functions as firebaseFunctions, storage } from '../../firebase';
import useAuthStore from '../../stores/authStore';
import usePageTitle from '../../hooks/usePageTitle';
import { trackButton, trackEvent } from '../../utils/analytics';
import {
  buildUserAccessDraft,
  coerceSimpleFieldValue,
  createEmptyCameraDraft,
  createEmptyClientDraft,
  createEmptyPresetDraft,
  formatUserLabel,
  getDefaultPresetProfile,
  hydrateCameraDraft,
  hydrateClientDraft,
  hydratePresetDraft,
  isReservedCameraFieldName,
  listCameraExtraFields,
  parseJsonObject,
  prettyPrintJson,
  removeTopLevelField,
  serializeCameraDocument,
  serializeClientDocument,
  serializePresetConfigList,
  serializePresetDocument,
  serializeUserAccessDocument,
  setTopLevelField,
  slugifyId,
  toCommaSeparatedList,
  updateNestedValue,
} from '../../utils/adminSettings';
import { uniqueIds } from '../../utils/access';
import './AdminSettings.css';

const DEFAULT_USER_DRAFT = {
  role: 'client',
  cameraIds: [],
  clientIds: [],
  manualLocationIds: [],
};

const TAB_OPTIONS = [
  { id: 'cameras', label: 'Cameras', icon: FiCamera },
  { id: 'clients', label: 'Clients', icon: FiSettings },
  { id: 'global', label: 'Global', icon: FiGlobe },
  { id: 'users', label: 'User Access', icon: FiUsers },
];

const MAX_VISIBLE_USERS = 20;
const ID_QUERY_BATCH_SIZE = 10;
const EMPTY_WHATSAPP_GROUP_DRAFT = {
  name: '',
  id: '',
};
const DEFAULT_GLOBAL_DEST_BUCKET = 'ting-vision.firebasestorage.app';
const DEFAULT_GLOBAL_LATEST_LOGO_PATH = '/logos/Latest_Sightings.png';
const DEFAULT_GLOBAL_ADMIN_WHATSAPP_GROUPS = [
  { name: 'Admins', id: '120363404393118610' },
];
const DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES = 60;
const DEFAULT_RARE_ALERT_ANIMALS = [
  'leopard',
  'lion',
  'cheetah',
  'wild_dog',
  'spotted_hyena',
  'impala',
  'bushbuck',
];
const ALERT_COOLDOWN_SPECIES = [
  { name: 'leopard', defaultMinutes: 15 },
  { name: 'lion', defaultMinutes: 15 },
  { name: 'cheetah', defaultMinutes: 15 },
  { name: 'wild_dog', defaultMinutes: 15 },
  { name: 'spotted_hyena', defaultMinutes: 15 },
  { name: 'elephant', defaultMinutes: 90 },
  { name: 'buffalo', defaultMinutes: 90 },
  { name: 'burchells_zebra', defaultMinutes: null },
  { name: 'giraffe', defaultMinutes: 60 },
  { name: 'impala', defaultMinutes: 600 },
  { name: 'waterbuck', defaultMinutes: 600 },
  { name: 'brown_hyena', defaultMinutes: null },
  { name: 'warthog', defaultMinutes: 400 },
  { name: 'hippopotamus', defaultMinutes: 600 },
  { name: 'wildebeest', defaultMinutes: 600 },
  { name: 'chacma_baboon', defaultMinutes: null },
  { name: 'kudu', defaultMinutes: 600 },
  { name: 'vervet_monkey', defaultMinutes: null },
  { name: 'bushbuck', defaultMinutes: null },
];
const ALERT_COOLDOWN_MODE_OPTIONS = [
  { value: 'minutes', label: 'Minutes' },
  { value: 'never', label: 'Never' },
];

const sortByLabel = (left, right, getLabel) =>
  getLabel(left).localeCompare(getLabel(right), undefined, { sensitivity: 'base' });

const upsertSortedItem = (items, nextItem, getLabel) => [
  ...items.filter((item) => item.id !== nextItem.id),
  nextItem,
].sort((left, right) => sortByLabel(left, right, getLabel));

const getPresetSortNumber = (preset) => {
  const numericValue = Number(
    preset?.backendId ??
    preset?.backend_id ??
    preset?.id,
  );

  return Number.isFinite(numericValue) ? numericValue : null;
};

const comparePresets = (left, right) => {
  const leftNumber = getPresetSortNumber(left);
  const rightNumber = getPresetSortNumber(right);

  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  if (leftNumber !== null && rightNumber === null) {
    return -1;
  }

  if (leftNumber === null && rightNumber !== null) {
    return 1;
  }

  const idCompare = String(left?.id || '').localeCompare(
    String(right?.id || ''),
    undefined,
    { numeric: true, sensitivity: 'base' },
  );

  if (idCompare !== 0) {
    return idCompare;
  }

  return String(left?.name || '').localeCompare(
    String(right?.name || ''),
    undefined,
    { sensitivity: 'base' },
  );
};

const sortPresets = (items = []) => [...items].sort(comparePresets);
const stringifyComparable = (value) => JSON.stringify(value ?? null);
const getSaveButtonClassName = (needsAttention) => (
  `settingsButton${needsAttention ? ' settingsButton--attention' : ''}`
);
const toAnalyticsError = (value) => String(value || '').slice(0, 120);

const chunkItems = (items = [], size = ID_QUERY_BATCH_SIZE) => {
  const next = [];

  for (let index = 0; index < items.length; index += size) {
    next.push(items.slice(index, index + size));
  }

  return next;
};

const parseIdList = (value) => uniqueIds(
  String(value || '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const buildDefaultWhatsAppGroupName = (index) => `Group ${index + 1}`;

const normalizeNamedWhatsAppGroups = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const next = [];

  value.forEach((entry) => {
    const nextIndex = next.length;
    const normalizedEntry = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry
      : { id: entry };
    const id = String(
      normalizedEntry?.id ??
      normalizedEntry?.groupId ??
      normalizedEntry?.group_id ??
      normalizedEntry?.value ??
      '',
    ).trim();
    const name = String(
      normalizedEntry?.name ??
      normalizedEntry?.label ??
      '',
    ).trim();

    if (!id || seen.has(id)) {
      return;
    }

    seen.add(id);
    next.push({
      name: name || buildDefaultWhatsAppGroupName(nextIndex),
      id,
    });
  });

  return next;
};

const buildAlertCooldownSpeciesLabel = (speciesName = '') => String(speciesName || '')
  .trim()
  .split('_')
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const normalizeAlertCooldownSpeciesName = (speciesName = '') => String(speciesName || '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '_');

const normalizeRareAnimalList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const next = [];

  value.forEach((speciesName) => {
    const normalizedSpeciesName = normalizeAlertCooldownSpeciesName(speciesName);
    if (!normalizedSpeciesName || seen.has(normalizedSpeciesName)) {
      return;
    }

    seen.add(normalizedSpeciesName);
    next.push(normalizedSpeciesName);
  });

  return next;
};

const normalizeAlertCooldownValue = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (!normalizedValue || normalizedValue === 'never' || normalizedValue === 'none') {
      return null;
    }
  }

  const parsedMinutes = Number(value);
  if (!Number.isFinite(parsedMinutes) || parsedMinutes < 0) {
    return undefined;
  }

  return Math.round(parsedMinutes);
};

const createAlertCooldownDraftEntry = (
  value,
  fallbackMinutes = DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES,
  rare = false,
) => {
  const normalizedValue = normalizeAlertCooldownValue(value);
  const safeFallbackMinutes = Number.isFinite(Number(fallbackMinutes)) && Number(fallbackMinutes) >= 0
    ? String(Math.round(Number(fallbackMinutes)))
    : String(DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES);

  if (normalizedValue === null) {
    return {
      mode: 'never',
      minutes: safeFallbackMinutes,
      rare: Boolean(rare),
    };
  }

  if (normalizedValue === undefined) {
    return {
      mode: 'minutes',
      minutes: safeFallbackMinutes,
      rare: Boolean(rare),
    };
  }

  return {
    mode: 'minutes',
    minutes: String(normalizedValue),
    rare: Boolean(rare),
  };
};

const buildDefaultAlertCooldownDraft = (rareAnimals = DEFAULT_RARE_ALERT_ANIMALS) => {
  const rareAnimalSet = new Set(normalizeRareAnimalList(rareAnimals));

  return ALERT_COOLDOWN_SPECIES.reduce((next, entry) => {
    next[entry.name] = createAlertCooldownDraftEntry(
      entry.defaultMinutes,
      entry.defaultMinutes ?? DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES,
      rareAnimalSet.has(entry.name),
    );
    return next;
  }, {});
};

const normalizeAlertCooldownDraft = (
  value,
  rareAnimals = DEFAULT_RARE_ALERT_ANIMALS,
) => {
  const normalizedRareAnimals = normalizeRareAnimalList(rareAnimals);
  const rareAnimalSet = new Set(normalizedRareAnimals);
  const next = buildDefaultAlertCooldownDraft(normalizedRareAnimals);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return next;
  }

  Object.entries(value).forEach(([speciesName, minutes]) => {
    const normalizedSpeciesName = normalizeAlertCooldownSpeciesName(speciesName);
    if (!normalizedSpeciesName) {
      return;
    }

    const fallbackMinutes = ALERT_COOLDOWN_SPECIES.find(
      (entry) => entry.name === normalizedSpeciesName,
    )?.defaultMinutes ?? DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES;

    const normalizedEntry = minutes && typeof minutes === 'object' && !Array.isArray(minutes)
      ? minutes
      : null;
    const nextEntry = createAlertCooldownDraftEntry(
      normalizedEntry?.minutes ?? normalizedEntry?.cooldown ?? minutes,
      fallbackMinutes ?? DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES,
      rareAnimalSet.has(normalizedSpeciesName),
    );

    if (normalizedEntry && Object.prototype.hasOwnProperty.call(normalizedEntry, 'rare')) {
      nextEntry.rare = Boolean(normalizedEntry.rare);
    }

    next[normalizedSpeciesName] = nextEntry;
  });

  return next;
};

const serializeAlertCooldownDraft = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const next = {};

  Object.entries(source).forEach(([speciesName, entry]) => {
    const normalizedSpeciesName = normalizeAlertCooldownSpeciesName(speciesName);
    if (!normalizedSpeciesName) {
      return;
    }

    const normalizedEntry = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry
      : createAlertCooldownDraftEntry(entry);

    if (normalizedEntry.mode === 'never') {
      next[normalizedSpeciesName] = null;
      return;
    }

    const parsedMinutes = normalizeAlertCooldownValue(normalizedEntry.minutes);
    if (parsedMinutes === undefined || parsedMinutes === null) {
      throw new Error(
        `Enter a valid cooldown in minutes for ${buildAlertCooldownSpeciesLabel(normalizedSpeciesName)}.`,
      );
    }

    next[normalizedSpeciesName] = parsedMinutes;
  });

  return next;
};

const serializeRareAnimalDraft = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  return Object.entries(source).reduce((next, [speciesName, entry]) => {
    const normalizedSpeciesName = normalizeAlertCooldownSpeciesName(speciesName);
    if (!normalizedSpeciesName) {
      return next;
    }

    if (entry && typeof entry === 'object' && !Array.isArray(entry) && entry.rare) {
      next.push(normalizedSpeciesName);
    }

    return next;
  }, []);
};

const createEmptyClientAlertDraft = () => ({
  livestreamUrl: '',
  lodgeLogoPath: '',
  includePresetDirections: true,
  lodgeWhatsappGroups: [],
  alertCooldowns: buildDefaultAlertCooldownDraft(),
});

const createEmptyGlobalSettingsDraft = () => ({
  defaultAdminWhatsappGroups: normalizeNamedWhatsAppGroups(DEFAULT_GLOBAL_ADMIN_WHATSAPP_GROUPS),
  destBucket: DEFAULT_GLOBAL_DEST_BUCKET,
  latestLogoPath: DEFAULT_GLOBAL_LATEST_LOGO_PATH,
});

const hydrateGlobalSettingsDraft = (settings = {}) => {
  const alerts = settings?.alerts && typeof settings.alerts === 'object' && !Array.isArray(settings.alerts)
    ? settings.alerts
    : {};
  const storageSettings = settings?.storage && typeof settings.storage === 'object' && !Array.isArray(settings.storage)
    ? settings.storage
    : {};
  const branding = settings?.branding && typeof settings.branding === 'object' && !Array.isArray(settings.branding)
    ? settings.branding
    : {};
  const normalizedAdminGroups = normalizeNamedWhatsAppGroups(
    alerts.defaultAdminWhatsappGroups,
  );

  return {
    defaultAdminWhatsappGroups: normalizedAdminGroups.length > 0
      ? normalizedAdminGroups
      : normalizeNamedWhatsAppGroups(DEFAULT_GLOBAL_ADMIN_WHATSAPP_GROUPS),
    destBucket: String(storageSettings.destBucket || DEFAULT_GLOBAL_DEST_BUCKET).trim(),
    latestLogoPath: String(branding.latestLogoPath || DEFAULT_GLOBAL_LATEST_LOGO_PATH).trim(),
  };
};

const hydrateClientAlertDraft = (client = {}) => {
  const alerts = client?.alerts && typeof client.alerts === 'object' && !Array.isArray(client.alerts)
    ? client.alerts
    : {};

  return {
    livestreamUrl: String(alerts.livestreamUrl || '').trim(),
    lodgeLogoPath: String(alerts.lodgeLogoPath || '').trim(),
    includePresetDirections: alerts.includePresetDirections !== false,
    lodgeWhatsappGroups: normalizeNamedWhatsAppGroups(alerts.lodgeWhatsappGroups),
    alertCooldowns: normalizeAlertCooldownDraft(alerts.alertCooldowns, alerts.rareAnimals),
  };
};

const buildLivestreamPlaceholder = (clientName = '') => {
  const handle = String(clientName || '')
    .trim()
    .replace(/[^a-zA-Z0-9-]+/g, '');

  if (!handle) {
    return 'https://www.youtube.com/@{clientname}/live';
  }

  return `https://www.youtube.com/@${handle}/live`;
};

const PRESET_ACTIVE_OPTIONS = [
  { value: 'Day', label: 'day' },
  { value: 'Night', label: 'night' },
];

const PRESET_SPOTTER_OPTIONS = [
  { value: 'motion', label: 'motion' },
  { value: 'yolo', label: 'yolo' },
  { value: 'both', label: 'both' },
];

const QUICK_PROFILE_OPTIONS = [
  { value: 'Day', label: 'Day' },
  { value: 'Night', label: 'Night' },
  { value: 'General', label: 'General' },
  { value: 'BackLight', label: 'BackLight' },
  { value: 'LowLight', label: 'LowLight' },
  { value: 'Custom1', label: 'Custom1' },
  { value: 'Custom2', label: 'Custom2' },
];

const normalizeNumericDraftValue = (value) => {
  if (value === '' || value === null || value === undefined) {
    return '';
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

const syncPresetProfileWithWhenIsActive = (draft, nextWhenIsActive) => {
  const currentProfile = String(draft?.profile || '').trim();
  const previousDefaultProfile = getDefaultPresetProfile(draft?.whenIsActive);
  const nextDefaultProfile = getDefaultPresetProfile(nextWhenIsActive);

  if (!currentProfile || currentProfile === previousDefaultProfile) {
    return nextDefaultProfile;
  }

  return draft?.profile || '';
};

const buildPresetSelectOptions = (baseOptions, currentValue) => {
  const normalizedValue = String(currentValue || '').trim();
  if (!normalizedValue || baseOptions.some((option) => option.value === normalizedValue)) {
    return baseOptions;
  }

  return [
    ...baseOptions,
    { value: normalizedValue, label: `${normalizedValue} (existing)` },
  ];
};

const normalizePresetListFromCallable = (items = []) => (Array.isArray(items) ? items : [])
  .map((item) => {
    const id = String(item?.id || item?.backend_id || item?.backendId || '').trim();
    if (!id) {
      return null;
    }

    return {
      ...hydratePresetDraft({ ...item, id }),
      id,
    };
  })
  .filter(Boolean)
  .sort(comparePresets);

const FALLBACK_TIMEZONES = [
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Africa/Windhoek',
  'UTC',
  'Europe/London',
  'Europe/Amsterdam',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Perth',
  'Australia/Sydney',
];

const buildTimeZoneOptions = (selectedValue = '') => {
  const timeZones = typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : FALLBACK_TIMEZONES;

  const values = Array.from(new Set([
    ...timeZones,
    selectedValue,
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right));

  return values.map((value) => ({
    value,
    label: value,
  }));
};

const formatZarAmount = (value) => {
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;

  if (typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function') {
    return `R${new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(safeValue)}`;
  }

  return `R${safeValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

function StatCard({ label, value, hint }) {
  return (
    <article className="adminSettings__stat">
      <span className="adminSettings__statLabel">{label}</span>
      <strong className="adminSettings__statValue">{value}</strong>
      {hint ? <span className="adminSettings__statHint">{hint}</span> : null}
    </article>
  );
}

function SectionCard({ title, description, actions, stickyActions = false, children }) {
  return (
    <section className="settingsCard">
      <header className="settingsCard__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? (
          <div className={`settingsCard__actions${stickyActions ? ' settingsCard__actions--sticky' : ''}`}>
            {actions}
          </div>
        ) : null}
      </header>
      <div className="settingsCard__body">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="settingsField">
      <span className="settingsField__label">{label}</span>
      {hint ? <span className="settingsField__hint">{hint}</span> : null}
      {children}
    </label>
  );
}

function TextInput({ label, hint, value, onChange, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="settingsInput"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </Field>
  );
}

function TextAreaInput({ label, hint, value, onChange, rows = 4, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        className="settingsTextarea"
        rows={rows}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
    </Field>
  );
}

function NamedWhatsAppGroupInput({
  label,
  hint,
  values,
  onChange,
  onTrackAction,
  namePlaceholder = 'Guests group',
  idPlaceholder = '120363421255773787',
  addLabel = 'Add group',
}) {
  const rows = Array.isArray(values) && values.length > 0 ? values : [EMPTY_WHATSAPP_GROUP_DRAFT];

  const updateValue = (index, field, nextValue) => {
    onChange(rows.map((value, currentIndex) => (
      currentIndex === index
        ? { ...value, [field]: nextValue }
        : value
    )));
  };

  const removeValue = (index) => {
    onTrackAction?.('remove', {
      index,
      remainingCount: Math.max(rows.length - 1, 0),
    });
    onChange(rows.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <Field label={label} hint={hint}>
      <div className="settingsArrayField">
        {rows.map((value, index) => (
          <div key={`${index}-${value?.id || value?.name || 'blank'}`} className="settingsNamedGroupField__row">
            <input
              className="settingsInput"
              value={value?.name ?? ''}
              onChange={(event) => updateValue(index, 'name', event.target.value)}
              placeholder={namePlaceholder}
            />
            <input
              className="settingsInput"
              value={value?.id ?? ''}
              onChange={(event) => updateValue(index, 'id', event.target.value)}
              placeholder={idPlaceholder}
            />
            <button
              type="button"
              className="settingsButton settingsButton--ghost settingsButton--small"
              onClick={() => removeValue(index)}
              disabled={rows.length === 1 && !String(value?.name || '').trim() && !String(value?.id || '').trim()}
            >
              <span>Remove</span>
            </button>
          </div>
        ))}

        <div className="settingsActionRow">
          <button
            type="button"
            className="settingsButton settingsButton--ghost settingsButton--small"
            onClick={() => {
              onTrackAction?.('add', {
                nextCount: rows.length + 1,
              });
              onChange([...rows, { ...EMPTY_WHATSAPP_GROUP_DRAFT }]);
            }}
          >
            <FiPlusCircle />
            <span>{addLabel}</span>
          </button>
        </div>
      </div>
    </Field>
  );
}

function AlertCooldownInput({
  label,
  hint,
  values,
  onChange,
  showRareColumn = false,
}) {
  const source = values && typeof values === 'object' && !Array.isArray(values)
    ? values
    : buildDefaultAlertCooldownDraft();

  const updateEntry = (speciesName, nextEntry) => {
    onChange({
      ...source,
      [speciesName]: {
        ...(source[speciesName] || createAlertCooldownDraftEntry(undefined)),
        ...nextEntry,
      },
    });
  };

  return (
    <Field label={label} hint={hint}>
      <div className="settingsCooldownField">
        {showRareColumn ? (
          <div className="settingsCooldownField__header">
            <span className="settingsCooldownField__headerLabel settingsCooldownField__headerLabel--species">
              Species
            </span>
            <span className="settingsCooldownField__headerLabel">Cooldown</span>
            <span className="settingsCooldownField__headerLabel settingsCooldownField__headerLabel--center">
              Rare
            </span>
          </div>
        ) : null}

        {ALERT_COOLDOWN_SPECIES.map(({ name, defaultMinutes }) => {
          const entry = source[name] || createAlertCooldownDraftEntry(defaultMinutes);
          const isNever = entry?.mode === 'never';
          const defaultLabel = defaultMinutes === null ? 'Never' : `${defaultMinutes} min`;

          return (
            <div
              key={name}
              className={`settingsCooldownField__row${showRareColumn ? ' settingsCooldownField__row--withRare' : ''}`}
            >
              <div className="settingsCooldownField__species">
                <strong>{buildAlertCooldownSpeciesLabel(name)}</strong>
                <span className="settingsInlineMeta">Default: {defaultLabel}</span>
              </div>

              <div className="settingsCooldownField__controls">
                <select
                  className="settingsInput"
                  value={isNever ? 'never' : 'minutes'}
                  onChange={(event) => {
                    const nextMode = event.target.value;
                    updateEntry(name, {
                      mode: nextMode,
                      minutes: nextMode === 'never'
                        ? (entry?.minutes || String(DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES))
                        : (entry?.minutes || String(defaultMinutes ?? DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES)),
                    });
                  }}
                >
                  {ALERT_COOLDOWN_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  min="0"
                  step="1"
                  className="settingsInput"
                  value={isNever ? '' : entry?.minutes ?? ''}
                  onChange={(event) => updateEntry(name, {
                    mode: 'minutes',
                    minutes: event.target.value,
                  })}
                  disabled={isNever}
                  placeholder={String(defaultMinutes ?? DEFAULT_CUSTOM_ALERT_COOLDOWN_MINUTES)}
                />

                <span className="settingsCooldownField__suffix">minutes</span>
              </div>

              {showRareColumn ? (
                <label className="settingsCooldownField__rareToggle">
                  <input
                    type="checkbox"
                    checked={Boolean(entry?.rare)}
                    onChange={(event) => updateEntry(name, { rare: event.target.checked })}
                  />
                  <span>Rare</span>
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
    </Field>
  );
}

function ImmutableIdField({
  label,
  hint,
  value,
  isNew,
  onChange,
  placeholder,
  suggestedValue,
  onUseSuggested,
}) {
  if (isNew) {
    return (
      <div className="settingsGrid settingsGrid--two">
        <TextInput
          label={label}
          hint={hint}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
        />
        <div className="settingsActionField">
          <span className="settingsField__label">Suggested ID</span>
          <button
            type="button"
            className="settingsButton settingsButton--ghost"
            onClick={onUseSuggested}
            disabled={!suggestedValue}
          >
            Use {suggestedValue || 'suggested ID'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settingsStaticField">
      <div className="settingsStaticField__header">
        <span className="settingsField__label">{label}</span>
      </div>
      {hint ? <span className="settingsField__hint">{hint}</span> : null}
      <div className="settingsStaticField__value">{value || 'Not set'}</div>
    </div>
  );
}

function SelectInput({ label, hint, value, onChange, options, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <select
        className="settingsInput"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ToggleInput({ label, hint, checked, onChange }) {
  return (
    <label className="settingsToggle">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

function ListButton({ active, title, meta, onClick }) {
  return (
    <button
      type="button"
      className={`settingsList__item${active ? ' settingsList__item--active' : ''}`}
      onClick={onClick}
    >
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </button>
  );
}

function BadgeList({ values, emptyLabel = 'None' }) {
  if (!Array.isArray(values) || values.length === 0) {
    return <div className="settingsEmptyText">{emptyLabel}</div>;
  }

  return (
    <div className="settingsBadges">
      {values.map((value) => (
        <span key={value} className="settingsBadge">{value}</span>
      ))}
    </div>
  );
}

const normalizeSearchValue = (value) => String(value || '').trim().toLowerCase();

const getUserDisplayName = (user = {}) => {
  const fullName = String(user?.fullName || '').trim();
  const email = String(user?.email || '').trim();
  const id = String(user?.id || '').trim();

  return fullName || email || id || 'Unknown user';
};

const getUserSecondaryLabel = (user = {}) => {
  const fullName = String(user?.fullName || '').trim();
  const email = String(user?.email || '').trim();
  const id = String(user?.id || '').trim();

  if (fullName && email) {
    return email;
  }

  if (id && id !== fullName && id !== email) {
    return id;
  }

  return '';
};

const getUserInitials = (user = {}) => {
  const label = getUserDisplayName(user);
  const parts = label.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '?';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const getStoredUserAccessSummary = (user = {}, options = {}) => {
  const cameraIds = uniqueIds(user?.cameraIds);
  const clientIds = uniqueIds(user?.clientIds);
  const locationIds = uniqueIds(user?.locationIds);
  const isAdmin = user?.role === 'admin';

  return {
    roleLabel: isAdmin ? 'Admin' : 'Client',
    cameraCount: isAdmin ? Number(options.allCameraCount ?? cameraIds.length) : cameraIds.length,
    clientCount: isAdmin ? Number(options.allClientCount ?? clientIds.length) : clientIds.length,
    legacyExtraCount: isAdmin ? 0 : locationIds.filter((value) => !cameraIds.includes(value)).length,
    isAdmin,
  };
};

const isUserUnassigned = (user = {}) => {
  const cameraIds = uniqueIds(user?.cameraIds);
  const clientIds = uniqueIds(user?.clientIds);

  return cameraIds.length === 0 && clientIds.length === 0;
};

function AccessSummaryCard({ label, value, hint, tone = 'default' }) {
  return (
    <article className={`settingsAccessSummaryCard settingsAccessSummaryCard--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function UserAccessListItem({ active, user, onClick, allCameraCount, allClientCount }) {
  const summary = getStoredUserAccessSummary(user, { allCameraCount, allClientCount });
  const displayName = getUserDisplayName(user);
  const secondaryLabel = getUserSecondaryLabel(user);

  return (
    <button
      type="button"
      className={`settingsUserListItem${active ? ' settingsUserListItem--active' : ''}`}
      onClick={onClick}
    >
      <span className="settingsUserListItem__avatar">{getUserInitials(user)}</span>
      <span className="settingsUserListItem__content">
        <span className="settingsUserListItem__top">
          <strong>{displayName}</strong>
          <span className={`settingsRoleBadge settingsRoleBadge--${summary.roleLabel.toLowerCase()}`}>
            {summary.roleLabel}
          </span>
        </span>
        {secondaryLabel ? (
          <span className="settingsUserListItem__secondary">{secondaryLabel}</span>
        ) : null}
        <span className="settingsUserListItem__meta">
          {summary.isAdmin
            ? `Automatic access to all ${summary.cameraCount} cameras / ${summary.clientCount} clients`
            : `${summary.cameraCount} cameras / ${summary.clientCount} clients / ${summary.legacyExtraCount} legacy extras`}
        </span>
      </span>
    </button>
  );
}

export default function AdminSettings({ mode = 'settings' }) {
  usePageTitle(mode === 'admin' ? 'Admin' : 'Settings');

  const role = useAuthStore((state) => state.role);
  const allowedClientIds = useAuthStore((state) => state.clientIds);
  const allowedCameraIds = useAuthStore((state) => state.cameraIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const isAdmin = role === 'admin';
  const workspaceTab = mode === 'admin' ? 'admin' : 'settings';

  const [activeTab, setActiveTab] = useState('cameras');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [noticeClosing, setNoticeClosing] = useState(false);

  const [clients, setClients] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [users, setUsers] = useState([]);
  const [presets, setPresets] = useState([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [loadedPresetCameraId, setLoadedPresetCameraId] = useState('');

  const [clientMode, setClientMode] = useState('existing');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clientDraftId, setClientDraftId] = useState('');
  const [clientDraft, setClientDraft] = useState(createEmptyClientDraft());
  const [clientSaving, setClientSaving] = useState(false);

  const [cameraMode, setCameraMode] = useState('existing');
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [cameraDraftId, setCameraDraftId] = useState('');
  const [cameraDraft, setCameraDraft] = useState(createEmptyCameraDraft());
  const [cameraJsonText, setCameraJsonText] = useState(
    prettyPrintJson(serializeCameraDocument(createEmptyCameraDraft())),
  );
  const [cameraJsonError, setCameraJsonError] = useState('');
  const [cameraSaving, setCameraSaving] = useState(false);
  const [cameraQuickAction, setCameraQuickAction] = useState('');
  const [cameraQuickProfile, setCameraQuickProfile] = useState('Day');
  const [cameraQuickIrValue, setCameraQuickIrValue] = useState('far100');
  const [cameraFilterClientId, setCameraFilterClientId] = useState('all');
  const [newCameraField, setNewCameraField] = useState({
    key: '',
    type: 'text',
    value: '',
  });

  const [presetMode, setPresetMode] = useState('new');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetDraftId, setPresetDraftId] = useState('');
  const [presetDraft, setPresetDraft] = useState(createEmptyPresetDraft());
  const [presetSaving, setPresetSaving] = useState(false);
  const [presetImporting, setPresetImporting] = useState(false);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [userDraft, setUserDraft] = useState(DEFAULT_USER_DRAFT);
  const [manualLocationText, setManualLocationText] = useState('');
  const [userSaving, setUserSaving] = useState(false);
  const [userSearchText, setUserSearchText] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userCameraSearchText, setUserCameraSearchText] = useState('');
  const [showSelectedCamerasOnly, setShowSelectedCamerasOnly] = useState(false);
  const [clientAlertDraft, setClientAlertDraft] = useState(() => createEmptyClientAlertDraft());
  const [clientAlertSaving, setClientAlertSaving] = useState(false);
  const [clientLogoUploading, setClientLogoUploading] = useState(false);
  const [clientLogoPreviewUrl, setClientLogoPreviewUrl] = useState('');
  const [clientLogoPreviewError, setClientLogoPreviewError] = useState('');
  const [globalSettings, setGlobalSettings] = useState(() => createEmptyGlobalSettingsDraft());
  const [globalSettingsDraft, setGlobalSettingsDraft] = useState(() => createEmptyGlobalSettingsDraft());
  const [globalSettingsSaving, setGlobalSettingsSaving] = useState(false);
  const [globalLogoUploading, setGlobalLogoUploading] = useState(false);
  const [globalLogoPreviewUrl, setGlobalLogoPreviewUrl] = useState('');
  const [globalLogoPreviewError, setGlobalLogoPreviewError] = useState('');

  const autoImportedPresetCameraIds = useRef(new Set());
  const presetEditorRef = useRef(null);
  const clientLogoFileInputRef = useRef(null);
  const globalLogoFileInputRef = useRef(null);

  const analyticsSection = workspaceTab === 'admin' ? activeTab : 'settings';
  const trackSettingsButton = useCallback((name, params = {}) => {
    trackButton(name, {
      workspace: workspaceTab,
      section: analyticsSection,
      ...params,
    });
  }, [analyticsSection, workspaceTab]);

  const trackSettingsEvent = useCallback((name, params = {}) => {
    trackEvent(name, {
      workspace: workspaceTab,
      section: analyticsSection,
      ...params,
    });
  }, [analyticsSection, workspaceTab]);

  const deferredUserSearchText = useDeferredValue(userSearchText);
  const deferredUserCameraSearchText = useDeferredValue(userCameraSearchText);
  const permittedClientIds = useMemo(() => uniqueIds(allowedClientIds), [allowedClientIds]);
  const permittedCameraIds = useMemo(() => uniqueIds(allowedCameraIds), [allowedCameraIds]);

  const cameraLookup = useMemo(
    () => new Map(cameras.map((camera) => [camera.id, camera])),
    [cameras],
  );

  const clientLookup = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  const filteredCameras = useMemo(() => {
    if (cameraFilterClientId === 'all') {
      return cameras;
    }

    return cameras.filter((camera) => camera.clientId === cameraFilterClientId);
  }, [cameras, cameraFilterClientId]);

  const groupedCameras = useMemo(() => {
    const groups = new Map();

    cameras.forEach((camera) => {
      const groupId = camera.clientId || 'unassigned';
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId).push(camera);
    });

    return Array.from(groups.entries())
      .map(([clientId, clientCameras]) => ({
        clientId,
        clientName: clientLookup.get(clientId)?.name || clientId || 'Unassigned',
        cameras: [...clientCameras].sort((left, right) => sortByLabel(
          left,
          right,
          (camera) => camera.displayName || camera.id,
        )),
      }))
      .sort((left, right) => left.clientName.localeCompare(right.clientName, undefined, { sensitivity: 'base' }));
  }, [cameras, clientLookup]);

  const allCameraIds = useMemo(
    () => uniqueIds(cameras.map((camera) => camera.id)),
    [cameras],
  );

  const allClientIds = useMemo(
    () => uniqueIds(clients.map((client) => client.id)),
    [clients],
  );

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) || null,
    [cameras, selectedCameraId],
  );

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) || null,
    [selectedUserId, users],
  );
  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) || null,
    [clients, selectedClientId],
  );
  const livestreamUrlPlaceholder = useMemo(
    () => buildLivestreamPlaceholder(selectedClient?.name || selectedClientId),
    [selectedClient, selectedClientId],
  );
  const clientAlertSavedDraft = useMemo(
    () => hydrateClientAlertDraft(selectedClient),
    [selectedClient],
  );
  const totalMonthlyRevenueZar = useMemo(
    () => clients.reduce((sum, client) => {
      if (client?.enabled === false) {
        return sum;
      }

      const price = Number(client?.monthlyPriceZar);
      return Number.isFinite(price) && price > 0 ? sum + price : sum;
    }, 0),
    [clients],
  );
  const globalSettingsSavedDraft = useMemo(
    () => hydrateGlobalSettingsDraft(globalSettings),
    [globalSettings],
  );
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) || null,
    [presets, selectedPresetId],
  );

  const selectedCameraTitle = useMemo(() => {
    if (cameraMode === 'new') {
      return 'New Camera';
    }

    const locationDisplayName = clientLookup.get(selectedCamera?.clientId)?.name
      || selectedCamera?.clientId
      || 'Unassigned';
    const cameraDisplayName = selectedCamera?.displayName || selectedCameraId;

    return `Camera: ${locationDisplayName} - ${cameraDisplayName}`;
  }, [cameraMode, clientLookup, selectedCamera, selectedCameraId]);

  const cameraQuickControlsDisabled = cameraMode === 'new' || !selectedCameraId;

  const suggestedClientId = useMemo(
    () => slugifyId(clientDraft.name),
    [clientDraft.name],
  );

  const suggestedCameraId = useMemo(() => {
    const clientId = slugifyId(cameraDraft.clientId);
    const cameraCode = slugifyId(cameraDraft.displayName);

    if (!clientId) {
      return cameraCode;
    }

    if (!cameraCode) {
      return clientId;
    }

    return `${clientId}-${cameraCode}`;
  }, [cameraDraft.clientId, cameraDraft.displayName]);

  const suggestedPresetId = useMemo(() => {
    if (presetDraft.backendId !== '' && presetDraft.backendId !== undefined && presetDraft.backendId !== null) {
      return String(presetDraft.backendId);
    }

    return slugifyId(presetDraft.name);
  }, [presetDraft.backendId, presetDraft.name]);

  const presetWhenOptions = useMemo(
    () => buildPresetSelectOptions(PRESET_ACTIVE_OPTIONS, presetDraft.whenIsActive),
    [presetDraft.whenIsActive],
  );

  const presetSpotterOptions = useMemo(
    () => buildPresetSelectOptions(PRESET_SPOTTER_OPTIONS, presetDraft.spotter),
    [presetDraft.spotter],
  );

  const clientTimeZoneOptions = useMemo(
    () => buildTimeZoneOptions(clientDraft.timezone),
    [clientDraft.timezone],
  );

  const derivedUserClientIds = useMemo(() => uniqueIds(
    userDraft.cameraIds
      .map((cameraId) => cameraLookup.get(cameraId)?.clientId)
      .filter(Boolean),
  ), [cameraLookup, userDraft.cameraIds]);

  const isSelectedUserAdmin = userDraft.role === 'admin';
  const displayedUserClientIds = isSelectedUserAdmin ? allClientIds : derivedUserClientIds;

  const selectedUserCameraIdSet = useMemo(
    () => new Set(userDraft.cameraIds),
    [userDraft.cameraIds],
  );

  const filteredUsers = useMemo(() => {
    const query = normalizeSearchValue(deferredUserSearchText);

    return users
      .filter((user) => {
        if (userRoleFilter !== 'all' && (user?.role === 'admin' ? 'admin' : 'client') !== userRoleFilter) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack = [
          formatUserLabel(user),
          user?.fullName,
          user?.email,
          user?.id,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      })
      .sort((left, right) => {
        const leftUnassigned = isUserUnassigned(left);
        const rightUnassigned = isUserUnassigned(right);

        if (leftUnassigned !== rightUnassigned) {
          return leftUnassigned ? -1 : 1;
        }

        return sortByLabel(left, right, formatUserLabel);
      });
  }, [deferredUserSearchText, userRoleFilter, users]);

  const visibleUsers = useMemo(() => {
    const limitedUsers = filteredUsers.slice(0, MAX_VISIBLE_USERS);

    if (!selectedUserId || limitedUsers.some((user) => user.id === selectedUserId)) {
      return limitedUsers;
    }

    const selectedVisibleUser = filteredUsers.find((user) => user.id === selectedUserId);
    if (!selectedVisibleUser) {
      return limitedUsers;
    }

    return [selectedVisibleUser, ...limitedUsers.slice(0, MAX_VISIBLE_USERS - 1)];
  }, [filteredUsers, selectedUserId]);

  const exactEmailMatchedUser = useMemo(() => {
    const query = normalizeSearchValue(userSearchText);
    if (!query) {
      return null;
    }

    return users.find((user) => normalizeSearchValue(user?.email) === query) || null;
  }, [userSearchText, users]);

  const selectedUserCameraDetails = useMemo(() => userDraft.cameraIds
    .map((cameraId) => {
      const camera = cameraLookup.get(cameraId);
      const clientId = camera?.clientId || '';
      const clientName = clientLookup.get(clientId)?.name || clientId || 'Unassigned';

      return {
        id: cameraId,
        displayName: camera?.displayName || cameraId,
        clientName,
      };
    })
    .sort((left, right) => {
      const clientCompare = left.clientName.localeCompare(right.clientName, undefined, { sensitivity: 'base' });
      if (clientCompare !== 0) {
        return clientCompare;
      }

      return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
    }), [cameraLookup, clientLookup, userDraft.cameraIds]);

  const filteredUserCameraGroups = useMemo(() => {
    const query = normalizeSearchValue(deferredUserCameraSearchText);

    return groupedCameras
      .filter((group) => {
        if (!query) {
          return true;
        }

        const clientHaystack = [
          group.clientName,
          group.clientId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return clientHaystack.includes(query);
      })
      .map((group) => {
        const visibleCameras = showSelectedCamerasOnly
          ? group.cameras.filter((camera) => selectedUserCameraIdSet.has(camera.id))
          : group.cameras;

        if (visibleCameras.length === 0) {
          return null;
        }

        return {
          ...group,
          visibleCameras,
          selectedCount: group.cameras.filter((camera) => selectedUserCameraIdSet.has(camera.id)).length,
        };
      })
      .filter(Boolean);
  }, [
    deferredUserCameraSearchText,
    groupedCameras,
    selectedUserCameraIdSet,
    showSelectedCamerasOnly,
  ]);

  const visibleUserCameraIds = useMemo(
    () => filteredUserCameraGroups.flatMap((group) => group.visibleCameras.map((camera) => camera.id)),
    [filteredUserCameraGroups],
  );

  const allVisibleUserCamerasSelected = useMemo(
    () => visibleUserCameraIds.length > 0 && visibleUserCameraIds.every((cameraId) => selectedUserCameraIdSet.has(cameraId)),
    [selectedUserCameraIdSet, visibleUserCameraIds],
  );

  const cameraExtraFields = useMemo(
    () => listCameraExtraFields(cameraDraft),
    [cameraDraft],
  );

  const fetchDocumentsByIds = useCallback(async (collectionName, ids) => {
    const uniqueDocIds = uniqueIds(ids);
    if (uniqueDocIds.length === 0) {
      return [];
    }

    const snapshots = await Promise.all(
      chunkItems(uniqueDocIds, ID_QUERY_BATCH_SIZE).map((idBatch) => getDocs(
        query(
          collection(db, collectionName),
          where(documentId(), 'in', idBatch),
        ),
      )),
    );

    return snapshots.flatMap((snapshot) => snapshot.docs);
  }, []);

  const refreshAllData = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
      setPageError('');
    }

    try {
      let clientDocs = [];
      let cameraDocs = [];
      let userDocs = [];
      let nextGlobalSettings = createEmptyGlobalSettingsDraft();

      if (isAdmin) {
        const [clientSnap, cameraSnap, userSnap, globalSettingsSnap] = await Promise.all([
          getDocs(collection(db, 'clients')),
          getDocs(collection(db, 'cameras')),
          getDocs(collection(db, 'users')),
          getDoc(doc(db, 'settings', 'global')),
        ]);

        clientDocs = clientSnap.docs;
        cameraDocs = cameraSnap.docs;
        userDocs = userSnap.docs;
        nextGlobalSettings = hydrateGlobalSettingsDraft(
          globalSettingsSnap.exists() ? globalSettingsSnap.data() : {},
        );
      } else {
        cameraDocs = await fetchDocumentsByIds('cameras', permittedCameraIds);
        const derivedClientIds = uniqueIds([
          ...permittedClientIds,
          ...cameraDocs.map((docSnap) => (
            docSnap.data()?.clientId ||
            docSnap.data()?.client_id ||
            ''
          )),
        ]);
        clientDocs = await fetchDocumentsByIds('clients', derivedClientIds);
      }

      const nextClients = clientDocs
        .map((docSnap) => ({
          ...hydrateClientDraft({ ...docSnap.data(), id: docSnap.id }),
          createdAt: docSnap.data()?.createdAt,
          updatedAt: docSnap.data()?.updatedAt,
        }))
        .sort((left, right) => sortByLabel(left, right, (client) => client.name || client.id));

      const nextCameras = cameraDocs
        .map((docSnap) => ({
          ...hydrateCameraDraft({ ...docSnap.data(), id: docSnap.id }),
          createdAt: docSnap.data()?.createdAt,
          updatedAt: docSnap.data()?.updatedAt,
        }))
        .sort((left, right) => sortByLabel(
          left,
          right,
          (camera) => camera.displayName || camera.id,
        ));

      const nextUsers = userDocs
        .map((docSnap) => ({ ...docSnap.data(), id: docSnap.id }))
        .sort((left, right) => sortByLabel(left, right, formatUserLabel));

      setClients(nextClients);
      setCameras(nextCameras);
      setUsers(nextUsers);
      if (isAdmin) {
        setGlobalSettings(nextGlobalSettings);
        setGlobalSettingsDraft((current) => (
          showLoading
            ? nextGlobalSettings
            : current
        ));
      }
    } catch (error) {
      console.error('Failed to load admin settings data', error);
      if (showLoading) {
        setPageError(error?.message || 'Unable to load settings from Firestore.');
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [fetchDocumentsByIds, isAdmin, permittedCameraIds, permittedClientIds]);

  const refreshPresets = useCallback(async (cameraId, { showLoading = true } = {}) => {
    if (!cameraId) {
      setPresets([]);
      setLoadedPresetCameraId('');
      if (showLoading) {
        setPresetsLoading(false);
      }
      return;
    }

    setLoadedPresetCameraId('');
    if (showLoading) {
      setPresetsLoading(true);
    }
    try {
      const presetSnap = await getDocs(collection(db, 'cameras', cameraId, 'presets'));
      const nextPresets = presetSnap.docs
        .map((docSnap) => ({
          ...hydratePresetDraft({ ...docSnap.data(), id: docSnap.id }),
          createdAt: docSnap.data()?.createdAt,
          updatedAt: docSnap.data()?.updatedAt,
        }))
        .sort(comparePresets);

      setPresets(nextPresets);
      setLoadedPresetCameraId(cameraId);
    } catch (error) {
      console.error('Failed to load presets', error);
      setLoadedPresetCameraId(cameraId);
      if (showLoading) {
        setNotice({
          type: 'error',
          text: error?.message || 'Unable to load presets for this camera.',
        });
        setPresets([]);
      }
    } finally {
      if (showLoading) {
        setPresetsLoading(false);
      }
    }
  }, []);

  const buildCameraJsonText = useCallback((draft, options = {}) => prettyPrintJson(
    serializeCameraDocument(draft, {
      cameraId: options.cameraId || (
        cameraMode === 'new'
          ? (cameraDraftId.trim() || suggestedCameraId)
          : selectedCameraId
      ),
      presets: options.presets,
    }),
  ), [cameraDraftId, cameraMode, selectedCameraId, suggestedCameraId]);

  const cameraSavedJsonText = useMemo(() => {
    if (cameraMode === 'new') {
      return prettyPrintJson(serializeCameraDocument(createEmptyCameraDraft(), {
        cameraId: '',
        presets: [],
      }));
    }

    if (!selectedCamera) {
      return '';
    }

    return buildCameraJsonText(hydrateCameraDraft(selectedCamera), {
      cameraId: selectedCamera.id,
      presets: Array.isArray(selectedCamera.PTZ_PRESETS) ? selectedCamera.PTZ_PRESETS : [],
    });
  }, [buildCameraJsonText, cameraMode, selectedCamera]);

  const cameraHasUnsavedChanges = useMemo(() => {
    const currentId = cameraMode === 'new' ? cameraDraftId.trim() : selectedCameraId;
    const savedId = cameraMode === 'new' ? '' : selectedCameraId;

    return currentId !== savedId || cameraJsonText !== cameraSavedJsonText;
  }, [cameraDraftId, cameraJsonText, cameraMode, cameraSavedJsonText, selectedCameraId]);

  const clientSavedPayload = useMemo(
    () => serializeClientDocument(clientMode === 'new'
      ? createEmptyClientDraft()
      : (selectedClient || createEmptyClientDraft())),
    [clientMode, selectedClient],
  );

  const clientHasUnsavedChanges = useMemo(() => {
    const currentId = clientMode === 'new' ? clientDraftId.trim() : selectedClientId;
    const savedId = clientMode === 'new' ? '' : selectedClientId;

    return currentId !== savedId
      || stringifyComparable(serializeClientDocument(clientDraft)) !== stringifyComparable(clientSavedPayload);
  }, [clientDraft, clientDraftId, clientMode, clientSavedPayload, selectedClientId]);
  const clientAlertHasUnsavedChanges = useMemo(() => (
    Boolean(selectedClientId)
      && stringifyComparable(clientAlertDraft) !== stringifyComparable(clientAlertSavedDraft)
  ), [clientAlertDraft, clientAlertSavedDraft, selectedClientId]);
  const settingsHasUnsavedChanges = clientAlertHasUnsavedChanges;
  const globalSettingsHasUnsavedChanges = useMemo(() => (
    stringifyComparable(globalSettingsDraft) !== stringifyComparable(globalSettingsSavedDraft)
  ), [globalSettingsDraft, globalSettingsSavedDraft]);

  const presetSavedPayload = useMemo(
    () => serializePresetDocument(presetMode === 'new'
      ? createEmptyPresetDraft()
      : (selectedPreset || createEmptyPresetDraft())),
    [presetMode, selectedPreset],
  );

  const presetHasUnsavedChanges = useMemo(() => {
    if (cameraMode === 'new' || !selectedCameraId) {
      return false;
    }

    const currentId = presetMode === 'new' ? presetDraftId.trim() : selectedPresetId;
    const savedId = presetMode === 'new' ? '' : selectedPresetId;

    return currentId !== savedId
      || stringifyComparable(serializePresetDocument(presetDraft)) !== stringifyComparable(presetSavedPayload);
  }, [
    cameraMode,
    presetDraft,
    presetDraftId,
    presetMode,
    presetSavedPayload,
    selectedCameraId,
    selectedPresetId,
  ]);

  const buildUserAccessPayload = useCallback((draft, manualLocationIdsOverride) => {
    const isAdminDraft = draft?.role === 'admin';
    const effectiveCameraIds = isAdminDraft
      ? allCameraIds
      : uniqueIds(draft?.cameraIds);
    const effectiveClientIds = isAdminDraft
      ? allClientIds
      : uniqueIds(
        effectiveCameraIds
          .map((cameraId) => cameraLookup.get(cameraId)?.clientId)
          .filter(Boolean),
      );
    const effectiveManualLocationIds = isAdminDraft
      ? []
      : uniqueIds(manualLocationIdsOverride ?? draft?.manualLocationIds);

    return serializeUserAccessDocument({
      ...draft,
      cameraIds: effectiveCameraIds,
      clientIds: effectiveClientIds,
      manualLocationIds: effectiveManualLocationIds,
    });
  }, [allCameraIds, allClientIds, cameraLookup]);

  const userSavedPayload = useMemo(
    () => buildUserAccessPayload(
      selectedUser
        ? buildUserAccessDraft({ user: selectedUser, cameraLookup })
        : { ...DEFAULT_USER_DRAFT, manualLocationIds: [] },
    ),
    [buildUserAccessPayload, cameraLookup, selectedUser],
  );

  const userHasUnsavedChanges = useMemo(() => {
    if (!selectedUserId) {
      return false;
    }

    const currentPayload = buildUserAccessPayload(
      userDraft,
      parseIdList(manualLocationText),
    );

    return stringifyComparable(currentPayload) !== stringifyComparable(userSavedPayload);
  }, [
    buildUserAccessPayload,
    manualLocationText,
    selectedUserId,
    userDraft,
    userSavedPayload,
  ]);

  const commitCameraDraft = useCallback((nextDraft, options = {}) => {
    setCameraDraft(nextDraft);
    setCameraJsonText(buildCameraJsonText(nextDraft, options));
    setCameraJsonError('');
  }, [buildCameraJsonText]);

  const loadClientEditor = useCallback((client, options = {}) => {
    const { source = 'auto' } = options;
    setClientMode('existing');
    setSelectedClientId(client.id);
    setClientDraftId(client.id);
    setClientDraft(hydrateClientDraft(client));
    if (source !== 'auto') {
      trackSettingsButton(workspaceTab === 'admin' ? 'admin_client_select' : 'settings_client_select', {
        source,
        clientId: client.id,
      });
    }
  }, [trackSettingsButton, workspaceTab]);

  const startNewClient = useCallback((options = {}) => {
    const { source = 'auto' } = options;
    setClientMode('new');
    setSelectedClientId('');
    setClientDraftId('');
    setClientDraft(createEmptyClientDraft());
    if (source !== 'auto') {
      trackSettingsButton('admin_client_new', { source });
    }
  }, [trackSettingsButton]);

  const loadCameraEditor = useCallback((camera, options = {}) => {
    const { source = 'auto' } = options;
    setCameraMode('existing');
    setSelectedCameraId(camera.id);
    setCameraDraftId(camera.id);
    setNewCameraField({ key: '', type: 'text', value: '' });
    commitCameraDraft(hydrateCameraDraft(camera), {
      cameraId: camera.id,
      presets: Array.isArray(camera.PTZ_PRESETS) ? camera.PTZ_PRESETS : undefined,
    });
    if (source !== 'auto') {
      trackSettingsButton(workspaceTab === 'admin' ? 'admin_camera_select' : 'settings_camera_select', {
        source,
        cameraId: camera.id,
        clientId: camera.clientId,
      });
    }
  }, [commitCameraDraft, trackSettingsButton, workspaceTab]);

  const startNewCamera = useCallback((preferredClientId = '', options = {}) => {
    const { source = 'auto' } = options;
    const nextDraft = createEmptyCameraDraft();
    nextDraft.clientId = preferredClientId || (cameraFilterClientId !== 'all' ? cameraFilterClientId : selectedClientId) || '';

    setCameraMode('new');
    setSelectedCameraId('');
    setCameraDraftId('');
    setNewCameraField({ key: '', type: 'text', value: '' });
    commitCameraDraft(nextDraft, { presets: [] });
    setPresetMode('new');
    setSelectedPresetId('');
    setPresetDraftId('');
    setPresetDraft(createEmptyPresetDraft());
    if (source !== 'auto') {
      trackSettingsButton('admin_camera_new', {
        source,
        clientId: nextDraft.clientId || '',
      });
    }
  }, [cameraFilterClientId, commitCameraDraft, selectedClientId, trackSettingsButton]);

  const loadPresetEditor = useCallback((preset, options = {}) => {
    const { source = 'auto' } = options;
    setPresetMode('existing');
    setSelectedPresetId(preset.id);
    setPresetDraftId(preset.id);
    setPresetDraft(hydratePresetDraft(preset));
    if (source !== 'auto') {
      trackSettingsButton('admin_preset_select', {
        source,
        presetId: preset.id,
      });
    }
  }, [trackSettingsButton]);

  const startNewPreset = useCallback((options = {}) => {
    const { source = 'auto' } = options;
    setPresetMode('new');
    setSelectedPresetId('');
    setPresetDraftId('');
    setPresetDraft(createEmptyPresetDraft());
    if (source !== 'auto') {
      trackSettingsButton('admin_preset_new', { source, cameraId: selectedCameraId });
    }
  }, [selectedCameraId, trackSettingsButton]);

  const loadUserEditor = useCallback((user, options = {}) => {
    const { source = 'auto' } = options;
    const nextDraft = buildUserAccessDraft({
      user,
      cameraLookup,
    });

    setSelectedUserId(user.id);
    setUserDraft(nextDraft);
    setManualLocationText(nextDraft.manualLocationIds.join(', '));
    if (source !== 'auto') {
      trackSettingsButton('admin_user_select', {
        source,
        userId: user.id,
        role: user.role === 'admin' ? 'admin' : 'client',
      });
    }
  }, [cameraLookup, trackSettingsButton]);

  useEffect(() => {
    if (role === 'guest' || (workspaceTab === 'admin' && !isAdmin)) {
      setLoading(false);
      return;
    }

    refreshAllData();
  }, [isAdmin, refreshAllData, role, workspaceTab]);

  useEffect(() => {
    if (!isAdmin || workspaceTab !== 'admin' || loading || clientMode === 'new') {
      return;
    }

    if (clients.length === 0) {
      startNewClient();
      return;
    }

    const selected = clients.find((client) => client.id === selectedClientId);
    if (!selected) {
      loadClientEditor(clients[0]);
    }
  }, [clientMode, clients, isAdmin, loading, loadClientEditor, selectedClientId, startNewClient, workspaceTab]);

  useEffect(() => {
    if (loading || (isAdmin && workspaceTab === 'admin')) {
      return;
    }

    if (clients.length === 0) {
      setSelectedClientId('');
      setClientDraftId('');
      setClientDraft(createEmptyClientDraft());
      return;
    }

    const selected = clients.find((client) => client.id === selectedClientId);
    if (!selected) {
      loadClientEditor(clients[0]);
    }
  }, [clients, isAdmin, loading, loadClientEditor, selectedClientId, workspaceTab]);

  useEffect(() => {
    if (!notice.text || notice.type === 'error') {
      setNoticeClosing(false);
      return undefined;
    }

    setNoticeClosing(false);

    const noticeKey = `${notice.type}:${notice.text}`;
    const fadeTimeoutId = window.setTimeout(() => {
      setNoticeClosing(true);
    }, 3000);

    const clearTimeoutId = window.setTimeout(() => {
      setNotice((current) => (
        `${current.type}:${current.text}` === noticeKey
          ? { type: '', text: '' }
          : current
      ));
      setNoticeClosing(false);
    }, 3400);

    return () => {
      window.clearTimeout(fadeTimeoutId);
      window.clearTimeout(clearTimeoutId);
    };
  }, [notice]);

  useEffect(() => {
    if (!isAdmin || workspaceTab !== 'admin' || loading || cameraMode === 'new') {
      return;
    }

    if (cameras.length === 0) {
      startNewCamera(selectedClientId);
      return;
    }

    const selected = cameras.find((camera) => camera.id === selectedCameraId);
    if (!selected) {
      loadCameraEditor(cameras[0]);
    }
  }, [
    cameraMode,
    cameras,
    isAdmin,
    loading,
    loadCameraEditor,
    selectedCameraId,
    selectedClientId,
    startNewCamera,
    workspaceTab,
  ]);

  const settingsAvailableCameras = useMemo(() => {
    if (!selectedClientId) {
      return cameras;
    }

    return cameras.filter((camera) => camera.clientId === selectedClientId);
  }, [cameras, selectedClientId]);

  useEffect(() => {
    if (loading || (isAdmin && workspaceTab === 'admin')) {
      return;
    }

    if (settingsAvailableCameras.length === 0) {
      setSelectedCameraId('');
      setCameraDraftId('');
      return;
    }

    const selected = settingsAvailableCameras.find((camera) => camera.id === selectedCameraId);
    if (!selected) {
      loadCameraEditor(settingsAvailableCameras[0]);
    }
  }, [
    isAdmin,
    loadCameraEditor,
    loading,
    selectedCameraId,
    settingsAvailableCameras,
    workspaceTab,
  ]);

  useEffect(() => {
    if (!isAdmin || loading) {
      return;
    }

    if (users.length === 0) {
      setSelectedUserId('');
      setUserDraft(DEFAULT_USER_DRAFT);
      setManualLocationText('');
      return;
    }

    const selected = users.find((user) => user.id === selectedUserId);
    if (!selected) {
      loadUserEditor(users[0]);
    }
  }, [isAdmin, loadUserEditor, loading, selectedUserId, users]);

  useEffect(() => {
    if (!isAdmin || loading || !exactEmailMatchedUser) {
      return;
    }

    if (exactEmailMatchedUser.id === selectedUserId) {
      return;
    }

    const matchedRole = exactEmailMatchedUser.role === 'admin' ? 'admin' : 'client';
    if (userRoleFilter !== 'all' && userRoleFilter !== matchedRole) {
      setUserRoleFilter('all');
    }

    loadUserEditor(exactEmailMatchedUser);
  }, [
    exactEmailMatchedUser,
    isAdmin,
    loadUserEditor,
    loading,
    selectedUserId,
    userRoleFilter,
  ]);

  useEffect(() => {
    if (!isAdmin || workspaceTab !== 'admin') {
      return;
    }

    if (cameraMode === 'new' || !selectedCameraId) {
      setPresets([]);
      startNewPreset();
      return;
    }

    refreshPresets(selectedCameraId);
  }, [cameraMode, isAdmin, refreshPresets, selectedCameraId, startNewPreset, workspaceTab]);

  useEffect(() => {
    setClientAlertDraft(hydrateClientAlertDraft(selectedClient));
  }, [selectedClient]);

  useEffect(() => {
    if (cameraMode === 'new' || presetMode === 'new') {
      return;
    }

    if (presets.length === 0) {
      startNewPreset();
      return;
    }

    const selected = presets.find((preset) => preset.id === selectedPresetId);
    if (!selected) {
      loadPresetEditor(presets[0]);
    }
  }, [cameraMode, loadPresetEditor, presetMode, presets, selectedPresetId, startNewPreset]);

  const handleRefresh = async () => {
    trackSettingsButton(workspaceTab === 'admin' ? 'admin_refresh' : 'settings_refresh', {
      cameraId: selectedCameraId,
      clientId: selectedClientId,
    });
    await refreshAllData();
    if (isAdmin && workspaceTab === 'admin' && selectedCameraId && cameraMode !== 'new') {
      await refreshPresets(selectedCameraId);
    }
  };

  const handleCameraFilterChange = useCallback((value) => {
    setCameraFilterClientId(value);
    trackSettingsEvent('admin_camera_filter', {
      clientId: value,
    });
  }, [trackSettingsEvent]);

  const handleAdminTabSelect = useCallback((tabId) => {
    setActiveTab(tabId);
    trackSettingsButton('admin_tab_select', { nextTab: tabId });
  }, [trackSettingsButton]);

  const handleClientLogoPickerOpen = useCallback(() => {
    trackSettingsButton('settings_location_logo_pick', {
      clientId: selectedClientId,
    });
    clientLogoFileInputRef.current?.click();
  }, [selectedClientId, trackSettingsButton]);

  const handleGlobalLogoPickerOpen = useCallback(() => {
    trackSettingsButton('admin_global_logo_pick');
    globalLogoFileInputRef.current?.click();
  }, [trackSettingsButton]);

  const handleShowSelectedCamerasToggle = useCallback(() => {
    let nextValue = false;
    setShowSelectedCamerasOnly((current) => {
      nextValue = !current;
      return nextValue;
    });
    trackSettingsButton('admin_user_selected_filter', { enabled: nextValue });
  }, [trackSettingsButton]);

  const handleUseSuggestedClientId = useCallback(() => {
    setClientDraftId(suggestedClientId);
    trackSettingsButton('admin_client_use_suggested_id', {
      suggestedId: suggestedClientId,
    });
  }, [suggestedClientId, trackSettingsButton]);

  const handleUseSuggestedCameraId = useCallback(() => {
    setCameraDraftId(suggestedCameraId);
    trackSettingsButton('admin_camera_use_suggested_id', {
      suggestedId: suggestedCameraId,
    });
  }, [suggestedCameraId, trackSettingsButton]);

  const handleUseSuggestedPresetId = useCallback(() => {
    setPresetDraftId(suggestedPresetId);
    trackSettingsButton('admin_preset_use_suggested_id', {
      suggestedId: suggestedPresetId,
      cameraId: selectedCameraId,
    });
  }, [selectedCameraId, suggestedPresetId, trackSettingsButton]);

  const handleClientWhatsAppGroupTrack = useCallback((action, params = {}) => {
    trackSettingsButton(`settings_whatsapp_group_${action}`, {
      clientId: selectedClientId,
      ...params,
    });
  }, [selectedClientId, trackSettingsButton]);

  const handleGlobalWhatsAppGroupTrack = useCallback((action, params = {}) => {
    trackSettingsButton(`admin_global_whatsapp_group_${action}`, params);
  }, [trackSettingsButton]);

  const updateCameraField = (path, value) => {
    commitCameraDraft(updateNestedValue(cameraDraft, path, value));
  };

  const getCameraDraftFromJson = useCallback(() => {
    try {
      return hydrateCameraDraft(parseJsonObject(cameraJsonText));
    } catch (error) {
      setCameraJsonError(error?.message || 'Camera JSON is invalid.');
      setNotice({ type: 'error', text: 'Fix the camera JSON before saving camera field changes.' });
      return null;
    }
  }, [cameraJsonText]);

  const getCameraSavePlan = useCallback((draftToSave) => {
    const targetId = cameraMode === 'new'
      ? (cameraDraftId.trim() || suggestedCameraId)
      : selectedCameraId;

    if (!targetId) {
      return {
        canPersist: false,
        targetId: '',
        message: 'Camera ID is required before Firestore can save this camera.',
      };
    }

    if (!draftToSave?.clientId?.trim()) {
      return {
        canPersist: false,
        targetId,
        message: 'Client Id is required before Firestore can save this camera.',
      };
    }

    if (!draftToSave?.displayName?.trim()) {
      return {
        canPersist: false,
        targetId,
        message: 'Camera name is required before Firestore can save this camera.',
      };
    }

    if (cameraMode === 'new' && cameras.some((camera) => camera.id === targetId)) {
      return {
        canPersist: false,
        targetId,
        message: `Camera ID "${targetId}" already exists.`,
      };
    }

    return {
      canPersist: true,
      targetId,
      message: '',
    };
  }, [cameraDraftId, cameraMode, cameras, selectedCameraId, suggestedCameraId]);

  const persistCameraDraft = useCallback(async (draftToSave, {
    successText = '',
    refreshPresetList = false,
    analyticsName = 'admin_camera_save',
    analyticsParams = {},
  } = {}) => {
    const plan = getCameraSavePlan(draftToSave);

    if (!plan.canPersist) {
      return {
        saved: false,
        targetId: plan.targetId,
        message: plan.message,
      };
    }

    trackSettingsButton(analyticsName, {
      ...analyticsParams,
      cameraId: plan.targetId,
      mode: cameraMode,
    });
    setCameraSaving(true);
    setNotice({ type: '', text: '' });

    try {
      const owningClient = clientLookup.get(draftToSave.clientId?.trim());
      let nextDraft = updateNestedValue(draftToSave, 'geo.timezone', owningClient?.timezone || '');
      nextDraft = updateNestedValue(nextDraft, 'geo.lat', owningClient?.geo?.lat ?? '');
      nextDraft = updateNestedValue(nextDraft, 'geo.lon', owningClient?.geo?.lon ?? '');

      const payload = serializeCameraDocument(nextDraft, {
        cameraId: plan.targetId,
        presets: presetsLoading ? nextDraft.PTZ_PRESETS : presets,
      });
      const existingCamera = cameras.find((camera) => camera.id === plan.targetId);
      const nextCamera = {
        ...hydrateCameraDraft({ ...payload, id: plan.targetId }),
        id: plan.targetId,
        createdAt: existingCamera?.createdAt,
        updatedAt: existingCamera?.updatedAt,
      };

      await setDoc(doc(db, 'cameras', plan.targetId), {
        ...payload,
        createdAt: existingCamera?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setCameras((current) => upsertSortedItem(current, nextCamera, (camera) => camera.displayName || camera.id));
      loadCameraEditor(nextCamera);
      setNotice({
        type: 'success',
        text: successText || `Saved camera ${plan.targetId}.`,
      });
      void refreshAllData({ showLoading: false });
      if (refreshPresetList) {
        void refreshPresets(plan.targetId, { showLoading: false });
      }

      trackSettingsEvent(`${analyticsName}_success`, {
        ...analyticsParams,
        cameraId: plan.targetId,
        mode: cameraMode,
      });

      return {
        saved: true,
        targetId: plan.targetId,
        message: '',
      };
    } catch (error) {
      console.error('Failed to save camera', error);
      const message = error?.message || 'Unable to save camera.';
      trackSettingsEvent(`${analyticsName}_error`, {
        ...analyticsParams,
        cameraId: plan.targetId,
        mode: cameraMode,
        error: toAnalyticsError(message),
      });
      setNotice({ type: 'error', text: message });
      return {
        saved: false,
        targetId: plan.targetId,
        message,
      };
    } finally {
      setCameraSaving(false);
    }
  }, [
    cameras,
    clientLookup,
    getCameraSavePlan,
    loadCameraEditor,
    presets,
    presetsLoading,
    refreshAllData,
    refreshPresets,
    cameraMode,
    trackSettingsButton,
    trackSettingsEvent,
  ]);

  const addCameraExtraField = async () => {
    const baseDraft = getCameraDraftFromJson();
    if (!baseDraft) {
      return;
    }

    const fieldKey = String(newCameraField.key || '').trim();

    if (!fieldKey) {
      setNotice({ type: 'error', text: 'Field name is required before adding it.' });
      return;
    }

    if (isReservedCameraFieldName(fieldKey)) {
      setNotice({ type: 'error', text: `"${fieldKey}" is already controlled by the main form.` });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(cameraDraft, fieldKey)) {
      setNotice({ type: 'error', text: `Field "${fieldKey}" already exists.` });
      return;
    }

    const nextDraft = setTopLevelField(
      baseDraft,
      fieldKey,
      coerceSimpleFieldValue(newCameraField.value, newCameraField.type),
    );

    commitCameraDraft(nextDraft);
    setNewCameraField({ key: '', type: 'text', value: '' });
    const result = await persistCameraDraft(nextDraft, {
      analyticsName: 'admin_camera_add_field',
      analyticsParams: { fieldKey },
      successText: `Added field "${fieldKey}" to ${getCameraSavePlan(nextDraft).targetId || 'camera'}.`,
    });

    if (!result.saved) {
      setNotice({
        type: 'info',
        text: `Field "${fieldKey}" was added locally, but not saved to Firestore yet. ${result.message}`,
      });
    }
  };

  const updateCameraExtraFieldValue = (fieldKey, type, value) => {
    commitCameraDraft(
      setTopLevelField(cameraDraft, fieldKey, coerceSimpleFieldValue(value, type)),
    );
  };

  const updateCameraExtraFieldType = (fieldKey, type) => {
    commitCameraDraft(
      setTopLevelField(
        cameraDraft,
        fieldKey,
        coerceSimpleFieldValue(cameraDraft?.[fieldKey], type),
      ),
    );
  };

  const removeCameraExtraFieldValue = async (fieldKey) => {
    const confirmed = window.confirm(`Remove "${fieldKey}" from this camera?`);
    if (!confirmed) {
      return;
    }

    const baseDraft = getCameraDraftFromJson();
    if (!baseDraft) {
      return;
    }

    const nextDraft = removeTopLevelField(baseDraft, fieldKey);
    commitCameraDraft(nextDraft);

    const result = await persistCameraDraft(nextDraft, {
      analyticsName: 'admin_camera_remove_field',
      analyticsParams: { fieldKey },
      successText: `Removed field "${fieldKey}" from ${getCameraSavePlan(nextDraft).targetId || 'camera'}.`,
    });

    if (!result.saved) {
      setNotice({
        type: 'info',
        text: `Field "${fieldKey}" was removed locally, but not saved to Firestore yet. ${result.message}`,
      });
    }
  };

  const saveClient = async () => {
    const targetId = clientMode === 'new'
      ? (clientDraftId.trim() || suggestedClientId)
      : selectedClientId;

    if (!targetId) {
      setNotice({ type: 'error', text: 'Client ID is required before saving.' });
      return;
    }

    if (!clientDraft.name?.trim()) {
      setNotice({ type: 'error', text: 'Client name is required before saving.' });
      return;
    }

    if (clientMode === 'new' && clients.some((client) => client.id === targetId)) {
      setNotice({ type: 'error', text: `Client ID "${targetId}" already exists.` });
      return;
    }

    trackSettingsButton('admin_client_save', {
      clientId: targetId,
      mode: clientMode,
    });
    setClientSaving(true);
    setNotice({ type: '', text: '' });

    try {
      const existingClient = clients.find((client) => client.id === targetId);
      const payload = serializeClientDocument(clientDraft);
      const nextClient = {
        ...hydrateClientDraft({ ...payload, id: targetId }),
        id: targetId,
        createdAt: existingClient?.createdAt,
        updatedAt: existingClient?.updatedAt,
      };

      await setDoc(doc(db, 'clients', targetId), {
        ...payload,
        createdAt: existingClient?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setClients((current) => upsertSortedItem(current, nextClient, (client) => client.name || client.id));
      loadClientEditor(nextClient);
      setNotice({ type: 'success', text: `Saved client ${targetId}.` });
      trackSettingsEvent('admin_client_save_success', {
        clientId: targetId,
        mode: clientMode,
      });
      void refreshAllData({ showLoading: false });
    } catch (error) {
      console.error('Failed to save client', error);
      trackSettingsEvent('admin_client_save_error', {
        clientId: targetId,
        mode: clientMode,
        error: toAnalyticsError(error?.message || 'Unable to save client.'),
      });
      setNotice({ type: 'error', text: error?.message || 'Unable to save client.' });
    } finally {
      setClientSaving(false);
    }
  };

  const saveClientAlertSettings = useCallback(async () => {
    if (!selectedClientId) {
      setNotice({ type: 'error', text: 'Pick a location before saving settings.' });
      return;
    }

    let alertCooldowns;
    let rareAnimals;
    try {
      alertCooldowns = serializeAlertCooldownDraft(clientAlertDraft.alertCooldowns);
      rareAnimals = serializeRareAnimalDraft(clientAlertDraft.alertCooldowns);
    } catch (error) {
      setNotice({ type: 'error', text: error?.message || 'Alert cooldowns are invalid.' });
      return;
    }

    trackSettingsButton('settings_alert_save', { clientId: selectedClientId });
    setClientAlertSaving(true);
    setNotice({ type: '', text: '' });

    try {
      const saveSettings = httpsCallable(firebaseFunctions, 'saveClientAlertSettings');
      const payload = {
        clientId: selectedClientId,
        livestreamUrl: clientAlertDraft.livestreamUrl,
        includePresetDirections: clientAlertDraft.includePresetDirections,
        lodgeWhatsappGroups: normalizeNamedWhatsAppGroups(clientAlertDraft.lodgeWhatsappGroups),
        alertCooldowns,
      };

      if (isAdmin) {
        payload.rareAnimals = rareAnimals;
      }

      const response = await saveSettings(payload);

      const savedAlerts = response?.data?.alerts || {};
      const savedStorage = response?.data?.storage || {};
      const nextAlerts = {
        includePresetDirections: savedAlerts.includePresetDirections !== false,
      };

      if (savedAlerts.livestreamUrl) {
        nextAlerts.livestreamUrl = savedAlerts.livestreamUrl;
      }

      if (savedAlerts.lodgeLogoPath) {
        nextAlerts.lodgeLogoPath = savedAlerts.lodgeLogoPath;
      }

      if (Array.isArray(savedAlerts.lodgeWhatsappGroups) && savedAlerts.lodgeWhatsappGroups.length > 0) {
        nextAlerts.lodgeWhatsappGroups = savedAlerts.lodgeWhatsappGroups;
      }

      if (savedAlerts.alertCooldowns && Object.keys(savedAlerts.alertCooldowns).length > 0) {
        nextAlerts.alertCooldowns = savedAlerts.alertCooldowns;
      }

      if (Array.isArray(savedAlerts.rareAnimals)) {
        nextAlerts.rareAnimals = savedAlerts.rareAnimals;
      }

      setClients((current) => current.map((client) => (
        client.id === selectedClientId
          ? { ...client, alerts: nextAlerts }
          : client
      )));
      setClientDraft((current) => ({ ...current, alerts: nextAlerts }));
      setClientAlertDraft(hydrateClientAlertDraft({ alerts: savedAlerts }));
      if (savedStorage.destBucket) {
        setGlobalSettingsDraft((current) => ({
          ...current,
          destBucket: savedStorage.destBucket,
        }));
      }
      setNotice({ type: 'success', text: `Saved settings for ${selectedClientId}.` });
      trackSettingsEvent('settings_alert_save_success', { clientId: selectedClientId });
      void refreshAllData({ showLoading: false });
    } catch (error) {
      console.error('Failed to save client alert settings', error);
      trackSettingsEvent('settings_alert_save_error', {
        clientId: selectedClientId,
        error: toAnalyticsError(error?.details || error?.message || 'Unable to save settings.'),
      });
      setNotice({
        type: 'error',
        text: error?.details || error?.message || 'Unable to save settings.',
      });
    } finally {
      setClientAlertSaving(false);
    }
  }, [
    clientAlertDraft,
    isAdmin,
    refreshAllData,
    selectedClientId,
    trackSettingsButton,
    trackSettingsEvent,
  ]);

  const uploadClientLodgeLogo = useCallback(async (file) => {
    if (!selectedClientId) {
      setNotice({ type: 'error', text: 'Pick a location before uploading an image.' });
      return;
    }

    if (!file) {
      return;
    }

    trackSettingsButton('settings_location_logo_upload', {
      clientId: selectedClientId,
      fileType: file.type || 'unknown',
    });
    setClientLogoUploading(true);
    setNotice({ type: '', text: '' });

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read that image file.'));
        reader.readAsDataURL(file);
      });

      const uploadLogo = httpsCallable(firebaseFunctions, 'uploadClientLodgeLogo');
      const response = await uploadLogo({
        clientId: selectedClientId,
        dataUrl,
      });
      const savedAlerts = response?.data?.alerts || {};
      const savedStorage = response?.data?.storage || {};
      const nextClientAlertDraft = hydrateClientAlertDraft({ alerts: savedAlerts });

      setClients((current) => current.map((client) => (
        client.id === selectedClientId
          ? { ...client, alerts: { ...(client.alerts || {}), ...savedAlerts } }
          : client
      )));
      setClientDraft((current) => ({
        ...current,
        alerts: { ...(current.alerts || {}), ...savedAlerts },
      }));
      setClientAlertDraft((current) => ({
        ...current,
        lodgeLogoPath: nextClientAlertDraft.lodgeLogoPath,
      }));
      if (savedStorage.destBucket) {
        setGlobalSettingsDraft((current) => ({
          ...current,
          destBucket: savedStorage.destBucket,
        }));
      }
      setNotice({ type: 'success', text: `Uploaded ${file.name}.` });
      trackSettingsEvent('settings_location_logo_upload_success', {
        clientId: selectedClientId,
      });
    } catch (error) {
      console.error('Failed to upload location image', error);
      trackSettingsEvent('settings_location_logo_upload_error', {
        clientId: selectedClientId,
        error: toAnalyticsError(error?.details || error?.message || 'Unable to upload the location image.'),
      });
      setNotice({
        type: 'error',
        text: error?.details || error?.message || 'Unable to upload the location image.',
      });
    } finally {
      setClientLogoUploading(false);
      if (clientLogoFileInputRef.current) {
        clientLogoFileInputRef.current.value = '';
      }
    }
  }, [selectedClientId, trackSettingsButton, trackSettingsEvent]);

  const handleClientLogoFileChange = useCallback((event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      return;
    }

    void uploadClientLodgeLogo(file);
  }, [uploadClientLodgeLogo]);

  const saveGlobalSettings = useCallback(async () => {
    if (!isAdmin) {
      setNotice({ type: 'error', text: 'Admin access is required.' });
      return;
    }

    trackSettingsButton('admin_global_save');
    setGlobalSettingsSaving(true);
    setNotice({ type: '', text: '' });

    try {
      const saveSettings = httpsCallable(firebaseFunctions, 'saveGlobalSettings');
      const response = await saveSettings({
        defaultAdminWhatsappGroups: normalizeNamedWhatsAppGroups(
          globalSettingsDraft.defaultAdminWhatsappGroups,
        ),
        destBucket: String(globalSettingsDraft.destBucket || '').trim(),
      });

      const nextGlobalSettings = hydrateGlobalSettingsDraft(response?.data?.settings || {});
      setGlobalSettings(nextGlobalSettings);
      setGlobalSettingsDraft(nextGlobalSettings);
      setNotice({ type: 'success', text: 'Saved global defaults.' });
      trackSettingsEvent('admin_global_save_success');
    } catch (error) {
      console.error('Failed to save global settings', error);
      trackSettingsEvent('admin_global_save_error', {
        error: toAnalyticsError(error?.details || error?.message || 'Unable to save global defaults.'),
      });
      setNotice({
        type: 'error',
        text: error?.details || error?.message || 'Unable to save global defaults.',
      });
    } finally {
      setGlobalSettingsSaving(false);
    }
  }, [globalSettingsDraft, isAdmin, trackSettingsButton, trackSettingsEvent]);

  const uploadGlobalLatestLogo = useCallback(async (file) => {
    if (!isAdmin) {
      setNotice({ type: 'error', text: 'Admin access is required.' });
      return;
    }

    if (!file) {
      return;
    }

    trackSettingsButton('admin_global_logo_upload', {
      fileType: file.type || 'unknown',
    });
    setGlobalLogoUploading(true);
    setNotice({ type: '', text: '' });

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read that image file.'));
        reader.readAsDataURL(file);
      });

      const uploadLogo = httpsCallable(firebaseFunctions, 'uploadGlobalLatestLogo');
      const response = await uploadLogo({
        dataUrl,
        destBucket: String(globalSettingsDraft.destBucket || '').trim(),
      });
      const savedSettings = hydrateGlobalSettingsDraft(response?.data?.settings || {});

      setGlobalSettings((current) => ({
        ...current,
        ...savedSettings,
      }));
      setGlobalSettingsDraft((current) => ({
        ...current,
        latestLogoPath: savedSettings.latestLogoPath,
        destBucket: savedSettings.destBucket || current.destBucket,
      }));
      setNotice({ type: 'success', text: `Uploaded ${file.name}.` });
      trackSettingsEvent('admin_global_logo_upload_success');
    } catch (error) {
      console.error('Failed to upload global latest logo', error);
      trackSettingsEvent('admin_global_logo_upload_error', {
        error: toAnalyticsError(error?.details || error?.message || 'Unable to upload the latest logo.'),
      });
      setNotice({
        type: 'error',
        text: error?.details || error?.message || 'Unable to upload the latest logo.',
      });
    } finally {
      setGlobalLogoUploading(false);
      if (globalLogoFileInputRef.current) {
        globalLogoFileInputRef.current.value = '';
      }
    }
  }, [globalSettingsDraft.destBucket, isAdmin, trackSettingsButton, trackSettingsEvent]);

  const handleGlobalLogoFileChange = useCallback((event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      return;
    }

    void uploadGlobalLatestLogo(file);
  }, [uploadGlobalLatestLogo]);

  const saveCamera = async () => {
    const parsedDraft = getCameraDraftFromJson();
    if (!parsedDraft) {
      return;
    }

    const plan = getCameraSavePlan(parsedDraft);
    if (!plan.canPersist) {
      setNotice({ type: 'error', text: plan.message });
      return;
    }

    await persistCameraDraft(parsedDraft, {
      successText: `Saved camera ${plan.targetId}.`,
      refreshPresetList: true,
    });
  };

  const runCameraQuickControl = useCallback(async (control, payload, successText) => {
    if (!selectedCameraId || cameraMode === 'new') {
      setNotice({ type: 'error', text: 'Save the camera first, then use quick controls.' });
      return;
    }

    trackSettingsButton('settings_camera_quick_control', {
      cameraId: selectedCameraId,
      control,
    });
    setCameraQuickAction(control);
    setNotice({ type: '', text: '' });

    try {
      const runControl = httpsCallable(firebaseFunctions, 'cameraQuickControl');
      const response = await runControl({
        cameraId: selectedCameraId,
        control,
        ...payload,
      });
      const result = response?.data || {};

      if (control === 'profile' && result.requestedProfile) {
        setCameraQuickProfile(result.requestedProfile);
      }

      if (control === 'ir' && result.requestedValue) {
        setCameraQuickIrValue(result.requestedValue);
      }

      setNotice({
        type: 'success',
        text: successText || `Ran ${control} for ${selectedCameraId}.`,
      });
      trackSettingsEvent('settings_camera_quick_control_success', {
        cameraId: selectedCameraId,
        control,
      });
    } catch (error) {
      console.error(`Failed to run quick control "${control}"`, error);
      trackSettingsEvent('settings_camera_quick_control_error', {
        cameraId: selectedCameraId,
        control,
        error: toAnalyticsError(error?.details || error?.message || `Unable to run ${control}.`),
      });
      setNotice({
        type: 'error',
        text: error?.details || error?.message || `Unable to run ${control}.`,
      });
    } finally {
      setCameraQuickAction('');
    }
  }, [cameraMode, selectedCameraId, trackSettingsButton, trackSettingsEvent]);

  const renamePresetOnCamera = useCallback(async ({ cameraId, presetId, name }) => {
    const runRename = httpsCallable(firebaseFunctions, 'renameCameraPreset');
    const response = await runRename({
      cameraId,
      presetId,
      name,
    });

    return response?.data || {};
  }, []);

  const savePreset = async () => {
    if (!selectedCameraId || cameraMode === 'new') {
      setNotice({ type: 'error', text: 'Save the camera first, then add presets.' });
      return;
    }

    const targetId = presetMode === 'new'
      ? (presetDraftId.trim() || suggestedPresetId)
      : selectedPresetId;

    if (!targetId) {
      setNotice({ type: 'error', text: 'Preset ID is required before saving.' });
      return;
    }

    if (!presetDraft.name?.trim()) {
      setNotice({ type: 'error', text: 'Preset name is required before saving.' });
      return;
    }

    if (presetMode === 'new' && presets.some((preset) => preset.id === targetId)) {
      setNotice({ type: 'error', text: `Preset ID "${targetId}" already exists for this camera.` });
      return;
    }

    trackSettingsButton('admin_preset_save', {
      cameraId: selectedCameraId,
      presetId: targetId,
      mode: presetMode,
    });
    setPresetSaving(true);
    setNotice({ type: '', text: '' });

    try {
      const existingPreset = presets.find((preset) => preset.id === targetId);
      const payload = serializePresetDocument(presetDraft);
      const existingPresetName = String(existingPreset?.name || '').trim();
      const nextPresetName = String(payload.name || '').trim();
      const shouldRenameOnCamera = (
        presetMode !== 'new'
        && Boolean(existingPreset)
        && nextPresetName.length > 0
        && nextPresetName !== existingPresetName
      );

      if (shouldRenameOnCamera) {
        const remotePresetId = Number(targetId);

        if (!Number.isFinite(remotePresetId)) {
          throw new Error('Only numeric preset IDs can be renamed on the camera.');
        }

        await renamePresetOnCamera({
          cameraId: selectedCameraId,
          presetId: remotePresetId,
          name: nextPresetName,
        });
      }

      const nextPresetEntries = presetMode === 'new'
        ? [...presets, { ...payload, id: targetId }]
        : presets.map((preset) => (
          preset.id === targetId ? { ...payload, id: targetId } : preset
        ));
      const nextPreset = {
        ...hydratePresetDraft({ ...payload, id: targetId }),
        id: targetId,
        createdAt: existingPreset?.createdAt,
        updatedAt: existingPreset?.updatedAt,
      };
      const nextPresetList = sortPresets([
        ...presets.filter((preset) => preset.id !== nextPreset.id),
        nextPreset,
      ]);

      await setDoc(doc(db, 'cameras', selectedCameraId, 'presets', targetId), {
        ...payload,
        createdAt: existingPreset?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'cameras', selectedCameraId), {
        PTZ_PRESETS: serializePresetConfigList(nextPresetEntries),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setPresets(nextPresetList);
      loadPresetEditor(nextPreset);
      setCameraJsonText(buildCameraJsonText(cameraDraft, {
        cameraId: selectedCameraId,
        presets: nextPresetEntries,
      }));
      setNotice({
        type: 'success',
        text: shouldRenameOnCamera
          ? `Saved preset ${targetId} and updated the camera preset name.`
          : `Saved preset ${targetId}.`,
      });
      trackSettingsEvent('admin_preset_save_success', {
        cameraId: selectedCameraId,
        presetId: targetId,
        mode: presetMode,
      });
      void refreshPresets(selectedCameraId, { showLoading: false });
    } catch (error) {
      console.error('Failed to save preset', error);
      trackSettingsEvent('admin_preset_save_error', {
        cameraId: selectedCameraId,
        presetId: targetId,
        mode: presetMode,
        error: toAnalyticsError(error?.details || error?.message || 'Unable to save preset.'),
      });
      setNotice({
        type: 'error',
        text: error?.details || error?.message || 'Unable to save preset.',
      });
    } finally {
      setPresetSaving(false);
    }
  };

  const importCameraPresets = useCallback(async ({ automatic = false } = {}) => {
    if (!selectedCameraId || cameraMode === 'new') {
      if (!automatic) {
        setNotice({ type: 'error', text: 'Save the camera first, then import presets.' });
      }
      return;
    }

    autoImportedPresetCameraIds.current.add(selectedCameraId);

    if (!automatic) {
      trackSettingsButton('admin_preset_import', {
        cameraId: selectedCameraId,
      });
    }
    setPresetImporting(true);
    if (!automatic) {
      setNotice({ type: '', text: '' });
    }

    try {
      const runImport = httpsCallable(firebaseFunctions, 'importCameraPresets');
      const response = await runImport({ cameraId: selectedCameraId });
      const payload = response?.data || {};
      const nextPresetList = normalizePresetListFromCallable(payload.presets);
      const importedCount = Number(payload.importedCount) || 0;
      const createdCount = Number(payload.createdCount) || 0;
      const updatedCount = Number(payload.updatedCount) || 0;

      setPresets(nextPresetList);
      setCameras((current) => current.map((camera) => (
        camera.id === selectedCameraId
          ? {
            ...camera,
            PTZ_PRESETS: Array.isArray(payload.presets) ? payload.presets : camera.PTZ_PRESETS,
          }
          : camera
      )));

      if (nextPresetList.length === 0) {
        startNewPreset();
      } else {
        const matchingPreset = nextPresetList.find((preset) => preset.id === selectedPresetId);
        loadPresetEditor(matchingPreset || nextPresetList[0]);
      }

      if (!automatic) {
        setNotice({
          type: 'success',
          text: importedCount === 0
            ? `No presets were returned for ${selectedCameraId}.`
            : `Imported ${importedCount} presets for ${selectedCameraId} (${createdCount} new, ${updatedCount} updated).`,
        });
        trackSettingsEvent('admin_preset_import_success', {
          cameraId: selectedCameraId,
          importedCount,
          createdCount,
          updatedCount,
        });
      }
    } catch (error) {
      console.error('Failed to import camera presets', error);
      if (!automatic) {
        trackSettingsEvent('admin_preset_import_error', {
          cameraId: selectedCameraId,
          error: toAnalyticsError(error?.details || error?.message || 'Unable to import presets from the camera.'),
        });
      }
      setNotice({
        type: 'error',
        text: error?.details || error?.message || 'Unable to import presets from the camera.',
      });
    } finally {
      setPresetImporting(false);
    }
  }, [
    cameraMode,
    loadPresetEditor,
    selectedCameraId,
    selectedPresetId,
    startNewPreset,
    trackSettingsButton,
    trackSettingsEvent,
  ]);

  const saveUserAccess = useCallback(async () => {
    if (!selectedUserId) {
      setNotice({ type: 'error', text: 'Select a user before saving access.' });
      return;
    }

    trackSettingsButton('admin_user_save', {
      userId: selectedUserId,
      role: userDraft.role,
    });
    setUserSaving(true);
    setNotice({ type: '', text: '' });

    try {
      const payload = buildUserAccessPayload(
        userDraft,
        parseIdList(manualLocationText),
      );
      const existingUser = users.find((user) => user.id === selectedUserId) || {};
      const nextUser = {
        ...existingUser,
        ...payload,
        id: selectedUserId,
      };

      await setDoc(doc(db, 'users', selectedUserId), {
        ...payload,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setUsers((current) => upsertSortedItem(current, nextUser, formatUserLabel));
      setUserDraft({
        ...userDraft,
        cameraIds: payload.cameraIds,
        clientIds: payload.clientIds,
        manualLocationIds: payload.locationIds.filter((value) => !payload.cameraIds.includes(value)),
      });
      setManualLocationText(payload.locationIds.filter((value) => !payload.cameraIds.includes(value)).join(', '));
      setNotice({ type: 'success', text: `Saved access for ${selectedUserId}.` });
      trackSettingsEvent('admin_user_save_success', {
        userId: selectedUserId,
        role: payload.role,
        cameraCount: payload.cameraIds.length,
      });
      void refreshAllData({ showLoading: false });
    } catch (error) {
      console.error('Failed to save user access', error);
      trackSettingsEvent('admin_user_save_error', {
        userId: selectedUserId,
        role: userDraft.role,
        error: toAnalyticsError(error?.message || 'Unable to save user access.'),
      });
      setNotice({ type: 'error', text: error?.message || 'Unable to save user access.' });
    } finally {
      setUserSaving(false);
    }
  }, [buildUserAccessPayload, manualLocationText, refreshAllData, selectedUserId, trackSettingsButton, trackSettingsEvent, userDraft, users]);

  const updateUserCameraSelection = useCallback((updater) => {
    setUserDraft((currentDraft) => {
      const baseCameraIds = uniqueIds(currentDraft.cameraIds);
      const nextCameraIds = uniqueIds(
        typeof updater === 'function' ? updater(baseCameraIds) : updater,
      );

      return {
        ...currentDraft,
        cameraIds: nextCameraIds,
        clientIds: uniqueIds(
          nextCameraIds
            .map((nextCameraId) => cameraLookup.get(nextCameraId)?.clientId)
          .filter(Boolean),
        ),
      };
    });
  }, [cameraLookup]);

  const toggleUserCamera = useCallback((cameraId, source = 'list') => {
    const currentlySelected = userDraft.cameraIds.includes(cameraId);
    updateUserCameraSelection((currentCameraIds) => (
      currentCameraIds.includes(cameraId)
        ? currentCameraIds.filter((id) => id !== cameraId)
        : [...currentCameraIds, cameraId]
    ));
    trackSettingsButton('admin_user_camera_toggle', {
      source,
      userId: selectedUserId,
      cameraId,
      selected: !currentlySelected,
    });
  }, [selectedUserId, trackSettingsButton, updateUserCameraSelection, userDraft.cameraIds]);

  const setManyUserCameras = useCallback((cameraIds, shouldInclude, source = 'toolbar') => {
    if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
      return;
    }

    updateUserCameraSelection((currentCameraIds) => {
      const next = new Set(currentCameraIds);

      cameraIds.forEach((cameraId) => {
        if (shouldInclude) {
          next.add(cameraId);
        } else {
          next.delete(cameraId);
        }
      });

      return Array.from(next);
    });
    trackSettingsButton('admin_user_camera_bulk', {
      source,
      userId: selectedUserId,
      action: shouldInclude ? 'select' : 'clear',
      count: cameraIds.length,
    });
  }, [selectedUserId, trackSettingsButton, updateUserCameraSelection]);

  useEffect(() => {
    if (!isAdmin || workspaceTab !== 'admin' || cameraMode === 'new' || !selectedCameraId) {
      return;
    }

    if (loadedPresetCameraId !== selectedCameraId) {
      return;
    }

    if (presetsLoading || presetImporting || presets.length > 0) {
      return;
    }

    if (autoImportedPresetCameraIds.current.has(selectedCameraId)) {
      return;
    }

    void importCameraPresets({ automatic: true });
  }, [
    cameraMode,
    isAdmin,
    importCameraPresets,
    loadedPresetCameraId,
    presetImporting,
    presets.length,
    presetsLoading,
    selectedCameraId,
    workspaceTab,
  ]);

  useEffect(() => {
    setCameraQuickAction('');
    setCameraQuickProfile('Day');
    setCameraQuickIrValue('far100');
  }, [selectedCameraId]);

  useEffect(() => {
    if (!presetEditorRef.current) {
      return;
    }

    presetEditorRef.current.scrollTop = 0;
  }, [presetMode, selectedCameraId, selectedPresetId]);

  useEffect(() => {
    const storagePath = String(clientAlertDraft.lodgeLogoPath || '')
      .trim()
      .replace(/^\/+/, '');
    const bucketName = String(globalSettingsDraft.destBucket || DEFAULT_GLOBAL_DEST_BUCKET).trim();

    if (!storagePath) {
      setClientLogoPreviewUrl('');
      setClientLogoPreviewError('');
      return undefined;
    }

    let cancelled = false;
    setClientLogoPreviewError('');

    const logoRef = bucketName
      ? storageRef(storage, `gs://${bucketName}/${storagePath}`)
      : storageRef(storage, storagePath);

    getDownloadURL(logoRef)
      .then((downloadUrl) => {
        if (!cancelled) {
          setClientLogoPreviewUrl(downloadUrl);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load location image preview', error);
          setClientLogoPreviewUrl('');
          setClientLogoPreviewError('Preview unavailable for the current location image.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientAlertDraft.lodgeLogoPath, globalSettingsDraft.destBucket]);

  useEffect(() => {
    const storagePath = String(globalSettingsDraft.latestLogoPath || '')
      .trim()
      .replace(/^\/+/, '');
    const bucketName = String(globalSettingsDraft.destBucket || DEFAULT_GLOBAL_DEST_BUCKET).trim();

    if (!storagePath) {
      setGlobalLogoPreviewUrl('');
      setGlobalLogoPreviewError('');
      return undefined;
    }

    let cancelled = false;
    setGlobalLogoPreviewError('');

    const logoRef = bucketName
      ? storageRef(storage, `gs://${bucketName}/${storagePath}`)
      : storageRef(storage, storagePath);

    getDownloadURL(logoRef)
      .then((downloadUrl) => {
        if (!cancelled) {
          setGlobalLogoPreviewUrl(downloadUrl);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load global logo preview', error);
          setGlobalLogoPreviewUrl('');
          setGlobalLogoPreviewError('Preview unavailable for the current logo path.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [globalSettingsDraft.destBucket, globalSettingsDraft.latestLogoPath]);

  const floatingSaveActions = [];

  if (workspaceTab === 'admin') {
    if (activeTab === 'cameras') {
      if (presetHasUnsavedChanges || presetSaving) {
        floatingSaveActions.push({
          key: 'preset',
          label: presetSaving ? 'Saving preset…' : 'Save Preset',
          onClick: savePreset,
          disabled: presetSaving,
        });
      }

      if (cameraHasUnsavedChanges || cameraSaving) {
        floatingSaveActions.push({
          key: 'camera',
          label: cameraSaving ? 'Saving camera…' : 'Save Camera',
          onClick: saveCamera,
          disabled: cameraSaving,
        });
      }
    }

    if (activeTab === 'clients' && (clientHasUnsavedChanges || clientSaving)) {
      floatingSaveActions.push({
        key: 'client',
        label: clientSaving ? 'Saving client…' : 'Save Client',
        onClick: saveClient,
        disabled: clientSaving,
      });
    }

    if (activeTab === 'users' && (userHasUnsavedChanges || userSaving)) {
      floatingSaveActions.push({
        key: 'access',
        label: userSaving ? 'Saving access…' : 'Save Access',
        onClick: saveUserAccess,
        disabled: !selectedUserId || userSaving,
      });
    }

    if (activeTab === 'global' && (globalSettingsHasUnsavedChanges || globalSettingsSaving)) {
      floatingSaveActions.push({
        key: 'global-settings',
        label: globalSettingsSaving ? 'Saving global defaults…' : 'Save Global Defaults',
        onClick: saveGlobalSettings,
        disabled: globalSettingsSaving || globalLogoUploading,
      });
    }
  }

  if (workspaceTab === 'settings' && (settingsHasUnsavedChanges || clientAlertSaving)) {
    floatingSaveActions.push({
      key: 'client-alerts',
      label: clientAlertSaving ? 'Saving settings…' : 'Save Settings',
      onClick: saveClientAlertSettings,
      disabled: !selectedClientId || clientAlertSaving || clientLogoUploading,
    });
  }

  if (isAccessLoading || loading) {
    return (
      <div className="adminSettings">
        <section className="adminSettings__emptyState">
          <h1>Loading settings…</h1>
          <p>Pulling clients, cameras, users, and presets from Firestore.</p>
        </section>
      </div>
    );
  }

  if (workspaceTab === 'admin' && !isAdmin) {
    return (
      <div className="adminSettings">
        <section className="adminSettings__emptyState">
          <FiShield className="adminSettings__emptyIcon" />
          <h1>Admin access required</h1>
          <p>This screen is only available to admin accounts.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="adminSettings">
      <section className="adminSettings__hero">
        <div>
          <span className="adminSettings__eyebrow">{workspaceTab === 'admin' && isAdmin ? 'Admin' : 'Settings'}</span>
          <h1>
            {workspaceTab === 'admin' && isAdmin
              ? 'Manage clients, cameras, presets, and user access'
              : 'Quick controls and settings'}
          </h1>
          <p>
            {workspaceTab === 'admin' && isAdmin
              ? 'Manage the Firestore records for clients, cameras, presets, and user access.'
              : 'Use safe day-to-day controls without opening the full admin toolbox.'}
          </p>
        </div>
        <div className="adminSettings__heroActions">
          <button type="button" className="settingsButton settingsButton--ghost" onClick={handleRefresh}>
            <FiRefreshCw />
            <span>Refresh</span>
          </button>
        </div>
      </section>

      {notice.text ? (
        <div className={`adminSettings__banner adminSettings__banner--${notice.type || 'info'}${noticeClosing ? ' adminSettings__banner--closing' : ''}`}>
          {notice.text}
        </div>
      ) : null}

      {pageError ? (
        <div className="adminSettings__banner adminSettings__banner--error">
          {pageError}
        </div>
      ) : null}

      {workspaceTab === 'settings' ? (
        <>
          <div className="adminSettings__layout">
            <div className="adminSettings__rail">
              <SectionCard
                title={isAdmin ? 'Locations' : 'Your locations'}
                description="Pick a location to change alert settings."
              >
                <div className="settingsList">
                  {clients.length === 0 ? (
                    <div className="settingsEmptyText">No locations are available for this account yet.</div>
                  ) : clients.map((client) => (
                    <ListButton
                      key={client.id}
                      active={selectedClientId === client.id}
                      title={client.name || client.id}
                      meta={client.id}
                      onClick={() => loadClientEditor(client, { source: 'list' })}
                    />
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title={isAdmin ? 'Cameras' : 'Your cameras'}
                description="Pick a camera to use the quick buttons."
              >
                <div className="settingsList">
                  {settingsAvailableCameras.length === 0 ? (
                    <div className="settingsEmptyText">No cameras are available for the selected location.</div>
                  ) : settingsAvailableCameras.map((camera) => (
                    <ListButton
                      key={camera.id}
                      active={selectedCameraId === camera.id}
                      title={camera.displayName || camera.id}
                      meta={clientLookup.get(camera.clientId)?.name || camera.clientId || 'No location'}
                      onClick={() => loadCameraEditor(camera, { source: 'list' })}
                    />
                  ))}
                </div>
              </SectionCard>
            </div>

            <div className="adminSettings__detail">
              <SectionCard
                title={selectedCameraId ? `Quick buttons for ${selectedCamera?.displayName || selectedCameraId}` : 'Quick buttons'}
                description="These are safe camera actions for everyday use."
              >
                {!selectedCameraId ? (
                  <div className="settingsEmptyText">Pick a camera first.</div>
                ) : (
                  <div className="settingsQuickControls">
                    <div className="settingsQuickControls__grid">
                      <div className="settingsQuickControls__card">
                        <div className="settingsQuickControls__title">Wipe lense</div>
                        <div className="settingsInlineMeta">
                          Turn on the wiper once to clean the lense
                        </div>
                        <div className="settingsActionRow">
                          <button
                            type="button"
                            className="settingsButton"
                            onClick={() => runCameraQuickControl(
                              'wiper',
                              {},
                              `Ran one wipe for ${selectedCameraId}.`,
                            )}
                            disabled={cameraQuickControlsDisabled || cameraQuickAction !== ''}
                          >
                            <span>{cameraQuickAction === 'wiper' ? 'Working…' : 'Wipe lense'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="settingsQuickControls__card">
                        <SelectInput
                          label="Select Camera Settings"
                          hint="Select to change the camera's exposure and colour settings"
                          value={cameraQuickProfile}
                          onChange={setCameraQuickProfile}
                          options={QUICK_PROFILE_OPTIONS}
                        />
                        <div className="settingsActionRow">
                          <button
                            type="button"
                            className="settingsButton"
                            onClick={() => runCameraQuickControl(
                              'profile',
                              { profile: cameraQuickProfile },
                              `Applied camera settings ${cameraQuickProfile} to ${selectedCameraId}.`,
                            )}
                            disabled={cameraQuickControlsDisabled || cameraQuickAction !== ''}
                          >
                            <span>{cameraQuickAction === 'profile' ? 'Working…' : 'Apply settings'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="settingsQuickControls__card">
                        <TextInput
                          label="Adjust IR"
                          hint="Change the infrared strength and focus. Use values like 70, far100, medium50, near80, or zoom30."
                          value={cameraQuickIrValue}
                          onChange={setCameraQuickIrValue}
                          placeholder="far100"
                        />
                        <div className="settingsActionRow">
                          <button
                            type="button"
                            className="settingsButton"
                            onClick={() => runCameraQuickControl(
                              'ir',
                              { irValue: cameraQuickIrValue },
                              `Applied IR setting ${cameraQuickIrValue} to ${selectedCameraId}.`,
                            )}
                            disabled={cameraQuickControlsDisabled || cameraQuickAction !== ''}
                          >
                            <span>{cameraQuickAction === 'ir' ? 'Working…' : 'Apply IR'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title={selectedClientId ? `Alert settings for ${selectedClient?.name || selectedClientId}` : 'Alert settings'}
                description="These settings save to the location record and apply to all cameras in this location's portfolio."
                stickyActions
                actions={(
                  <button
                    type="button"
                    className={getSaveButtonClassName(
                      settingsHasUnsavedChanges && !clientAlertSaving,
                    )}
                    onClick={saveClientAlertSettings}
                    disabled={!selectedClientId || clientAlertSaving || clientLogoUploading}
                  >
                    <FiSave />
                    <span>{clientAlertSaving ? 'Saving…' : 'Save Settings'}</span>
                  </button>
                )}
              >
                {!selectedClientId ? (
                  <div className="settingsEmptyText">Pick a location first.</div>
                ) : (
                  <>
                    <div className="settingsGlobalLogoCard">
                      <div className="settingsGlobalLogoCard__preview">
                        {clientLogoPreviewUrl ? (
                          <img
                            src={clientLogoPreviewUrl}
                            alt={`${selectedClient?.name || selectedClientId} preview`}
                            className="settingsGlobalLogoCard__image"
                          />
                        ) : (
                          <div className="settingsGlobalLogoCard__empty">
                            <span>No location preview yet</span>
                          </div>
                        )}
                      </div>

                      <div className="settingsGlobalLogoCard__content">
                        <div className="settingsGlobalLogoCard__header">
                          <strong>Location</strong>
                        </div>

                        <div className="settingsInlineMeta">
                          This image is added to the alert image for this location.
                        </div>

                        {clientLogoPreviewError ? (
                          <div className="settingsInlineMeta settingsGlobalLogoCard__warning">
                            {clientLogoPreviewError}
                          </div>
                        ) : null}

                        <input
                          ref={clientLogoFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="settingsGlobalLogoCard__fileInput"
                          onChange={handleClientLogoFileChange}
                        />

                        <div className="settingsActionRow">
                          <button
                            type="button"
                            className="settingsButton settingsButton--ghost"
                            onClick={handleClientLogoPickerOpen}
                            disabled={clientLogoUploading}
                          >
                            <FiUploadCloud />
                            <span>{clientLogoUploading ? 'Uploading…' : 'Upload Image'}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <TextInput
                      label="Livestream URL"
                      hint="Optional link included in alerts when this location wants viewers to jump to the live feed."
                      value={clientAlertDraft.livestreamUrl}
                      onChange={(value) => setClientAlertDraft((current) => ({ ...current, livestreamUrl: value }))}
                      placeholder={livestreamUrlPlaceholder}
                    />

                    <ToggleInput
                      label="Include preset directions"
                      hint="Adds preset direction details into alert messages when they are available."
                      checked={clientAlertDraft.includePresetDirections}
                      onChange={(value) => setClientAlertDraft((current) => ({ ...current, includePresetDirections: value }))}
                    />

                    <NamedWhatsAppGroupInput
                      label="WhatsApp Groups"
                      hint="Give each location WhatsApp group a name and its group ID."
                      values={clientAlertDraft.lodgeWhatsappGroups}
                      onChange={(value) => setClientAlertDraft((current) => ({ ...current, lodgeWhatsappGroups: value }))}
                      onTrackAction={handleClientWhatsAppGroupTrack}
                      namePlaceholder="Guests group"
                      idPlaceholder="120363421255773787"
                      addLabel="Add Group"
                    />

                    <AlertCooldownInput
                      label="Alert cooldowns"
                      hint="'Never' means that species will never trigger a WhatsApp alert."
                      values={clientAlertDraft.alertCooldowns}
                      onChange={(value) => setClientAlertDraft((current) => ({ ...current, alertCooldowns: value }))}
                      showRareColumn={isAdmin}
                    />
                  </>
                )}
              </SectionCard>
            </div>
          </div>
        </>
      ) : null}

      {workspaceTab === 'admin' && isAdmin ? (
        <>
          <div className="adminSettings__stats">
            <StatCard label="Clients" value={clients.length} hint="Business accounts / locations" />
            <StatCard label="MRR" value={formatZarAmount(totalMonthlyRevenueZar)} hint="Enabled client revenue per month" />
            <StatCard label="Cameras" value={cameras.length} hint="Actual camera devices" />
            <StatCard label="Users" value={users.length} hint="Accounts with permissions" />
          </div>

          <div className="adminSettings__tabs">
            {TAB_OPTIONS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`adminSettings__tab${activeTab === tab.id ? ' adminSettings__tab--active' : ''}`}
                  onClick={() => handleAdminTabSelect(tab.id)}
                >
                  <Icon />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

      {activeTab === 'cameras' ? (
        <div className="adminSettings__layout adminSettings__layout--camera">
          <div className="adminSettings__rail">
            <SectionCard
              title="Camera List"
              description="Pick a camera to edit it, or start a new one."
              actions={(
                <button
                  type="button"
                  className="settingsButton"
                  onClick={() => startNewCamera(
                    cameraFilterClientId !== 'all' ? cameraFilterClientId : selectedClientId,
                    { source: 'button' },
                  )}
                >
                  <FiPlusCircle />
                  <span>New Camera</span>
                </button>
              )}
            >
              <SelectInput
                label="Filter by client"
                value={cameraFilterClientId}
                onChange={handleCameraFilterChange}
                options={[
                  { value: 'all', label: 'All clients' },
                  ...clients.map((client) => ({
                    value: client.id,
                    label: client.name || client.id,
                  })),
                ]}
              />

              <div className="settingsList">
                {filteredCameras.length === 0 ? (
                  <div className="settingsEmptyText">
                    No cameras match this filter yet.
                  </div>
                ) : filteredCameras.map((camera) => (
                  <ListButton
                    key={camera.id}
                    active={cameraMode !== 'new' && selectedCameraId === camera.id}
                    title={camera.displayName || camera.id}
                    meta={clientLookup.get(camera.clientId)?.name || camera.clientId || 'No client'}
                    onClick={() => loadCameraEditor(camera, { source: 'list' })}
                  />
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="adminSettings__detail">
            <SectionCard
              title={selectedCameraTitle}
              description="Use the normal form for everyday settings. Use the JSON box when you need extra fields that are not on the form yet."
              stickyActions
              actions={(
                <button
                  type="button"
                  className={getSaveButtonClassName(cameraHasUnsavedChanges && !cameraSaving)}
                  onClick={saveCamera}
                  disabled={cameraSaving}
                >
                  <FiSave />
                  <span>{cameraSaving ? 'Saving…' : 'Save Camera'}</span>
                </button>
              )}
            >
              <ImmutableIdField
                label="cameraId"
                hint="Stable system ID. Keep it boring and permanent."
                value={cameraMode === 'new' ? cameraDraftId : selectedCameraId}
                isNew={cameraMode === 'new'}
                onChange={setCameraDraftId}
                placeholder={suggestedCameraId || 'river-house--main-ptz'}
                suggestedValue={suggestedCameraId}
                onUseSuggested={handleUseSuggestedCameraId}
              />

              <div className="settingsGrid settingsGrid--two">
                <TextInput
                  label="Client Id"
                  hint="Which client owns this camera."
                  value={cameraDraft.clientId || ''}
                  onChange={(value) => updateCameraField('clientId', value)}
                  list="camera-client-options"
                  placeholder="river-house"
                />
                <TextInput
                  label="displayName"
                  hint="Human-friendly label admins will read."
                  value={cameraDraft.displayName || ''}
                  onChange={(value) => updateCameraField('displayName', value)}
                  placeholder="Main PTZ"
                />
              </div>

              <datalist id="camera-client-options">
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name || client.id}
                  </option>
                ))}
              </datalist>

              <ToggleInput
                label="Camera enabled"
                hint="Turn this off to keep the config but mark the camera inactive."
                checked={cameraDraft.enabled}
                onChange={(value) => updateCameraField('enabled', value)}
              />

              <div className="settingsSectionDivider" />

              <h3 className="settingsSubheading">Network</h3>
              <div className="settingsGrid settingsGrid--three">
                <TextInput
                  label="Public IP"
                  value={cameraDraft.network?.publicIp || ''}
                  onChange={(value) => updateCameraField('network.publicIp', value)}
                  placeholder="102.221.112.138"
                />
                <TextInput
                  label="Private IP"
                  value={cameraDraft.network?.privateIp || ''}
                  onChange={(value) => updateCameraField('network.privateIp', value)}
                  placeholder="192.168.10.20"
                />
              </div>

              <div className="settingsGrid settingsGrid--four">
                <TextInput
                  label="PTZ channel"
                  type="number"
                  value={cameraDraft.network?.ptzChannel ?? ''}
                  onChange={(value) => updateCameraField('network.ptzChannel', value)}
                />
                <TextInput
                  label="PTZ HTTP port"
                  type="number"
                  value={cameraDraft.network?.ptzHttpPort ?? ''}
                  onChange={(value) => updateCameraField('network.ptzHttpPort', value)}
                />
                <TextInput
                  label="RTSP port"
                  type="number"
                  value={cameraDraft.network?.rtspPort ?? ''}
                  onChange={(value) => updateCameraField('network.rtspPort', value)}
                />
                <TextInput
                  label="RTSP subtype"
                  type="number"
                  value={cameraDraft.network?.rtspSubtype ?? ''}
                  onChange={(value) => updateCameraField('network.rtspSubtype', value)}
                />
              </div>

              <div className="settingsGrid settingsGrid--two">
                <TextInput
                  label="RTSP path"
                  value={cameraDraft.network?.rtspPath || ''}
                  onChange={(value) => updateCameraField('network.rtspPath', value)}
                  placeholder="/cam/realmonitor"
                />
                <TextInput
                  label="Dahua API version"
                  value={cameraDraft.network?.dahuaApiVersion || ''}
                  onChange={(value) => updateCameraField('network.dahuaApiVersion', value)}
                  placeholder="v2"
                />
              </div>

              <div className="settingsSectionDivider" />

              <h3 className="settingsSubheading">Tour</h3>
              <div className="settingsInlineMeta">
                Latitude, longitude, and timezone come from the selected client.
              </div>
              <div className="settingsGrid settingsGrid--two">
                <TextInput
                  label="Tour mode"
                  value={cameraDraft.tour?.mode || ''}
                  onChange={(value) => updateCameraField('tour.mode', value)}
                  placeholder="auto"
                />
                <TextInput
                  label="Preset settle sec"
                  type="number"
                  step="any"
                  value={cameraDraft.overrides?.presetMoveSettleSec ?? ''}
                  onChange={(value) => updateCameraField('overrides.presetMoveSettleSec', value)}
                />
              </div>

              <div className="settingsGrid settingsGrid--two">
                <TextInput
                  label="Day preset IDs"
                  hint="Comma-separated. Example: 1, 2, 3"
                  value={toCommaSeparatedList(cameraDraft.tour?.dayPresetIds)}
                  onChange={(value) => updateCameraField('tour.dayPresetIds', parseIdList(value))}
                />
                <TextInput
                  label="Night preset IDs"
                  hint="Comma-separated. Example: 40, 41, 42"
                  value={toCommaSeparatedList(cameraDraft.tour?.nightPresetIds)}
                  onChange={(value) => updateCameraField('tour.nightPresetIds', parseIdList(value))}
                />
              </div>

              <div className="settingsSectionDivider" />

              <div className="settingsSubsection">
                <h3 className="settingsSubheading">Extra fields</h3>
                <div className="settingsInlineMeta">
                  Add simple top-level config fields that are not covered by the main form.
                </div>

                <div className="settingsCreateFieldCard">
                  <div className="settingsCreateFieldCard__header">
                    <strong>Create field</strong>
                    <span>Add a simple top-level backend config field.</span>
                  </div>

                  <div className="settingsExtraFieldRow settingsExtraFieldRow--new">
                    <div className="settingsExtraFieldCell settingsExtraFieldCell--field" data-label="Field">
                      <input
                        className="settingsInput"
                        value={newCameraField.key}
                        onChange={(event) => setNewCameraField((current) => ({ ...current, key: event.target.value }))}
                        placeholder="Field name"
                        aria-label="Field name"
                      />
                    </div>

                    <div className="settingsExtraFieldCell settingsExtraFieldCell--type" data-label="Type">
                      <select
                        className="settingsInput"
                        value={newCameraField.type}
                        onChange={(event) => setNewCameraField((current) => ({
                          ...current,
                          type: event.target.value,
                          value: event.target.value === 'boolean' ? 'false' : event.target.value === 'number' ? 0 : '',
                        }))}
                        aria-label="Field type"
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                      </select>
                    </div>

                    <div className="settingsExtraFieldCell settingsExtraFieldCell--value" data-label="Value">
                      {newCameraField.type === 'boolean' ? (
                        <select
                          className="settingsInput"
                          value={String(newCameraField.value)}
                          onChange={(event) => setNewCameraField((current) => ({ ...current, value: event.target.value }))}
                          aria-label="Field value"
                        >
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : (
                        <input
                          className="settingsInput"
                          type={newCameraField.type === 'number' ? 'number' : 'text'}
                          value={newCameraField.value}
                          onChange={(event) => setNewCameraField((current) => ({ ...current, value: event.target.value }))}
                          placeholder={newCameraField.type === 'number' ? '0' : 'Value'}
                          aria-label="Field value"
                        />
                      )}
                    </div>

                    <div className="settingsExtraFieldCell settingsExtraFieldCell--action" data-label="Action">
                      <button
                        type="button"
                        className="settingsButton"
                        onClick={addCameraExtraField}
                        disabled={cameraSaving}
                      >
                        <FiPlusCircle />
                        <span>Create field</span>
                      </button>
                    </div>
                  </div>
                </div>

                {cameraExtraFields.length === 0 ? (
                  <div className="settingsEmptyText">No extra simple fields yet.</div>
                ) : (
                  <>
                    <div className="settingsExtraFieldHeader" aria-hidden="true">
                      <span>Field</span>
                      <span>Type</span>
                      <span>Value</span>
                      <span>Action</span>
                    </div>

                    <div className="settingsExtraFieldList">
                      {cameraExtraFields.map((field) => (
                        <div key={field.key} className="settingsExtraFieldRow">
                          <div className="settingsExtraFieldCell settingsExtraFieldCell--field" data-label="Field">
                            <div className="settingsExtraFieldName">{field.key}</div>
                          </div>

                          <div className="settingsExtraFieldCell settingsExtraFieldCell--type" data-label="Type">
                            <select
                              className="settingsInput"
                              value={field.type}
                              onChange={(event) => updateCameraExtraFieldType(field.key, event.target.value)}
                              aria-label={`Type for ${field.key}`}
                            >
                              <option value="text">Text</option>
                              <option value="number">Number</option>
                              <option value="boolean">Boolean</option>
                            </select>
                          </div>

                          <div className="settingsExtraFieldCell settingsExtraFieldCell--value" data-label="Value">
                            {field.type === 'boolean' ? (
                              <select
                                className="settingsInput"
                                value={field.value ? 'true' : 'false'}
                                onChange={(event) => updateCameraExtraFieldValue(field.key, 'boolean', event.target.value)}
                                aria-label={`Value for ${field.key}`}
                              >
                                <option value="true">True</option>
                                <option value="false">False</option>
                              </select>
                            ) : (
                              <input
                                className="settingsInput"
                                type={field.type === 'number' ? 'number' : 'text'}
                                value={field.value ?? ''}
                                onChange={(event) => updateCameraExtraFieldValue(field.key, field.type, event.target.value)}
                                aria-label={`Value for ${field.key}`}
                              />
                            )}
                          </div>

                          <div className="settingsExtraFieldCell settingsExtraFieldCell--action" data-label="Action">
                            <button
                              type="button"
                              className="settingsButton settingsButton--ghost"
                              onClick={() => removeCameraExtraFieldValue(field.key)}
                              disabled={cameraSaving}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="settingsQuickSaveBar">
                  <div className="settingsQuickSaveBar__text">
                    <strong>Value and type changes still need save</strong>
                    <span>Add/remove saves immediately. Use this button after editing existing extra fields.</span>
                  </div>
                  <button
                    type="button"
                    className={getSaveButtonClassName(cameraHasUnsavedChanges && !cameraSaving)}
                    onClick={saveCamera}
                    disabled={cameraSaving}
                  >
                    <FiSave />
                    <span>{cameraSaving ? 'Saving…' : 'Save Camera'}</span>
                  </button>
                </div>
              </div>

              <div className="settingsSectionDivider" />

              <TextAreaInput
                label="Camera JSON"
                hint="Advanced mode. This box uses the backend config field names saved to Firestore."
                value={cameraJsonText}
                onChange={setCameraJsonText}
                rows={18}
                spellCheck={false}
              />
              {cameraJsonError ? (
                <div className="settingsInlineError">{cameraJsonError}</div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Presets"
              description={
                selectedCamera
                  ? `Presets live under cameras/${selectedCamera.id}/presets/{presetId}.`
                  : 'Save a camera first to start adding presets.'
              }
              actions={(
                <div className="settingsActionRow">
                  <button
                    type="button"
                    className="settingsButton settingsButton--ghost"
                    onClick={() => importCameraPresets()}
                    disabled={!selectedCamera || cameraMode === 'new' || presetImporting}
                  >
                    <FiRefreshCw />
                    <span>{presetImporting ? 'Importing…' : 'Import From Camera'}</span>
                  </button>
                  <button
                    type="button"
                    className="settingsButton"
                    onClick={() => startNewPreset({ source: 'button' })}
                    disabled={!selectedCamera || cameraMode === 'new' || presetImporting}
                  >
                    <FiPlusCircle />
                    <span>New Preset</span>
                  </button>
                </div>
              )}
            >
              {cameraMode === 'new' || !selectedCamera ? (
                <div className="settingsEmptyText">
                  Save the camera first to add presets.
                </div>
              ) : (
                <>
                  <div className="settingsInlineMeta">
                    {presetImporting
                      ? 'Importing presets from the camera…'
                      : (presetsLoading
                        ? 'Loading presets…'
                        : `${presets.length} preset${presets.length === 1 ? '' : 's'} found`)}
                  </div>

                  <div className="settingsPresetLayout">
                    <div className="settingsList settingsPresetList">
                      {presets.length === 0 ? (
                        <div className="settingsEmptyText">
                          No presets saved for this camera yet.
                        </div>
                      ) : presets.map((preset) => (
                        <ListButton
                          key={preset.id}
                          active={presetMode !== 'new' && selectedPresetId === preset.id}
                          title={preset.name || preset.id}
                          meta={`${preset.id}${preset.whenIsActive ? ` • ${preset.whenIsActive}` : ''}`}
                          onClick={() => loadPresetEditor(preset, { source: 'list' })}
                        />
                      ))}
                    </div>

                    <div className="settingsPresetEditor" ref={presetEditorRef}>
                      <ImmutableIdField
                        label="presetId"
                        hint="Stable preset document ID."
                        value={presetMode === 'new' ? presetDraftId : selectedPresetId}
                        isNew={presetMode === 'new'}
                        onChange={setPresetDraftId}
                        placeholder={suggestedPresetId || '1'}
                        suggestedValue={suggestedPresetId}
                        onUseSuggested={handleUseSuggestedPresetId}
                      />

                      <div className="settingsGrid settingsGrid--two">
                        <TextInput
                          label="Name"
                          value={presetDraft.name || ''}
                          onChange={(value) => setPresetDraft((current) => ({ ...current, name: value }))}
                          placeholder="WB1"
                        />
                        <TextInput
                          label="Backend ID"
                          type="number"
                          step="1"
                          value={presetDraft.backendId ?? ''}
                          onChange={(value) => setPresetDraft((current) => ({
                            ...current,
                            backendId: normalizeNumericDraftValue(value),
                          }))}
                        />
                      </div>

                      <div className="settingsGrid settingsGrid--two">
                        <SelectInput
                          label="whenIsActive"
                          value={presetDraft.whenIsActive || ''}
                          onChange={(value) => setPresetDraft((current) => ({
                            ...current,
                            whenIsActive: value,
                            profile: syncPresetProfileWithWhenIsActive(current, value),
                          }))}
                          options={presetWhenOptions}
                        />
                        <SelectInput
                          label="spotter"
                          value={presetDraft.spotter || ''}
                          onChange={(value) => setPresetDraft((current) => ({ ...current, spotter: value }))}
                          options={presetSpotterOptions}
                        />
                      </div>

                      <div className="settingsGrid settingsGrid--two">
                        <TextInput
                          label="Profile"
                          value={presetDraft.profile || ''}
                          onChange={(value) => setPresetDraft((current) => ({ ...current, profile: value }))}
                          placeholder={getDefaultPresetProfile(presetDraft.whenIsActive) || 'Day'}
                        />
                        <TextInput
                          label="Distance (m)"
                          type="number"
                          step="any"
                          value={presetDraft.distanceM ?? ''}
                          onChange={(value) => setPresetDraft((current) => ({
                            ...current,
                            distanceM: normalizeNumericDraftValue(value),
                          }))}
                        />
                      </div>

                      <div className="settingsGrid settingsGrid--two">
                        <TextInput
                          label="Side of camera"
                          value={presetDraft.side_of_camera || ''}
                          onChange={(value) => setPresetDraft((current) => ({
                            ...current,
                            side_of_camera: value,
                          }))}
                          placeholder="right"
                        />
                        <TextInput
                          label="Side of river"
                          value={presetDraft.side_of_river || ''}
                          onChange={(value) => setPresetDraft((current) => ({
                            ...current,
                            side_of_river: value,
                          }))}
                          placeholder="far"
                        />
                      </div>

                      <ToggleInput
                        label="Preset enabled"
                        checked={presetDraft.enabled}
                        onChange={(value) => setPresetDraft((current) => ({ ...current, enabled: value }))}
                      />

                      <div className="settingsActionRow settingsActionRow--sticky">
                        <button
                          type="button"
                          className={getSaveButtonClassName(presetHasUnsavedChanges && !presetSaving)}
                          onClick={savePreset}
                          disabled={presetSaving}
                        >
                          <FiSave />
                          <span>{presetSaving ? 'Saving…' : 'Save Preset'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </SectionCard>
          </div>
        </div>
      ) : null}

      {activeTab === 'clients' ? (
        <div className="adminSettings__layout">
          <div className="adminSettings__rail">
            <SectionCard
              title="Client List"
              description="Create the business account once, then hang cameras under it."
              actions={(
                <button type="button" className="settingsButton" onClick={() => startNewClient({ source: 'button' })}>
                  <FiPlusCircle />
                  <span>New Client</span>
                </button>
              )}
            >
              <div className="settingsList">
                {clients.length === 0 ? (
                  <div className="settingsEmptyText">No clients yet.</div>
                ) : clients.map((client) => (
                  <ListButton
                    key={client.id}
                    active={clientMode !== 'new' && selectedClientId === client.id}
                    title={client.name || client.id}
                    meta={`${client.id}${client.timezone ? ` • ${client.timezone}` : ''}`}
                    onClick={() => loadClientEditor(client, { source: 'list' })}
                  />
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="adminSettings__detail">
            <SectionCard
              title={clientMode === 'new' ? 'New Client' : (clientDraft.name || selectedClientId)}
              description={clientMode === 'new' ? 'Create a new client record.' : undefined}
              stickyActions
              actions={(
                <button
                  type="button"
                  className={getSaveButtonClassName(clientHasUnsavedChanges && !clientSaving)}
                  onClick={saveClient}
                  disabled={clientSaving}
                >
                  <FiSave />
                  <span>{clientSaving ? 'Saving…' : 'Save Client'}</span>
                </button>
              )}
            >
              <ImmutableIdField
                label="Client Id"
                value={clientMode === 'new' ? clientDraftId : selectedClientId}
                isNew={clientMode === 'new'}
                onChange={setClientDraftId}
                placeholder={suggestedClientId || 'river-house'}
                suggestedValue={suggestedClientId}
                onUseSuggested={handleUseSuggestedClientId}
              />

              <div className="settingsGrid settingsGrid--two">
                <TextInput
                  label="Client name"
                  value={clientDraft.name || ''}
                  onChange={(value) => setClientDraft((current) => ({ ...current, name: value }))}
                  placeholder="River House"
                />
                <SelectInput
                  label="Timezone"
                  value={clientDraft.timezone || ''}
                  onChange={(value) => setClientDraft((current) => ({ ...current, timezone: value }))}
                  options={clientTimeZoneOptions}
                />
              </div>

              <div className="settingsGrid settingsGrid--two">
                <SelectInput
                  label="Client type"
                  hint="Choose whether this location is a lodge or a private property."
                  value={clientDraft.clientType || 'lodge'}
                  onChange={(value) => setClientDraft((current) => ({ ...current, clientType: value }))}
                  options={[
                    { value: 'lodge', label: 'Lodge' },
                    { value: 'private', label: 'Private' },
                  ]}
                />
                <TextInput
                  label="Monthly price (Rands)"
                  hint="Saved as a Rand amount on the client record."
                  type="number"
                  min="0"
                  step="1"
                  value={clientDraft.monthlyPriceZar ?? ''}
                  onChange={(value) => setClientDraft((current) => ({ ...current, monthlyPriceZar: value }))}
                  placeholder="15000"
                />
              </div>

              <TextAreaInput
                label="Address"
                value={clientDraft.address || ''}
                onChange={(value) => setClientDraft((current) => ({ ...current, address: value }))}
                rows={3}
                placeholder="123 River Road, Malelane"
              />

              <div className="settingsGrid settingsGrid--two">
                <TextInput
                  label="Latitude"
                  type="number"
                  step="any"
                  value={clientDraft.geo?.lat ?? ''}
                  onChange={(value) => setClientDraft((current) => updateNestedValue(current, 'geo.lat', value))}
                />
                <TextInput
                  label="Longitude"
                  type="number"
                  step="any"
                  value={clientDraft.geo?.lon ?? ''}
                  onChange={(value) => setClientDraft((current) => updateNestedValue(current, 'geo.lon', value))}
                />
              </div>

              <ToggleInput
                label="Client enabled"
                hint="Keep the account in the system but mark it inactive if needed."
                checked={clientDraft.enabled}
                onChange={(value) => setClientDraft((current) => ({ ...current, enabled: value }))}
              />

              <div className="settingsSectionDivider" />

              <div className="settingsInlineMeta">
                Cameras currently linked to this client: {
                  cameras.filter((camera) => camera.clientId === (clientMode === 'new' ? clientDraftId || suggestedClientId : selectedClientId)).length
                }
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}

      {activeTab === 'global' ? (
        <div className="adminSettings__layout">
          <div className="adminSettings__rail">
            <SectionCard
              title="Global Defaults"
              description="These settings apply across every location unless a location-specific override takes over."
            >
              <div className="settingsInlineMeta">
                In plain English: this is the master control panel for shared admin WhatsApp groups,
                the shared destination bucket, and the shared Latest Sightings logo.
              </div>

              <div className="settingsBadges">
                <span className="settingsBadge">All locations</span>
                <span className="settingsBadge">Admin only</span>
                <span className="settingsBadge">Firestore-backed</span>
              </div>
            </SectionCard>
          </div>

          <div className="adminSettings__detail">
            <SectionCard
              title="Global Defaults"
              description="Change the shared defaults here, then the detector will pick them up from Firestore."
              stickyActions
              actions={(
                <button
                  type="button"
                  className={getSaveButtonClassName(globalSettingsHasUnsavedChanges && !globalSettingsSaving)}
                  onClick={saveGlobalSettings}
                  disabled={globalSettingsSaving || globalLogoUploading}
                >
                  <FiSave />
                  <span>{globalSettingsSaving ? 'Saving…' : 'Save Global Defaults'}</span>
                </button>
              )}
            >
              <NamedWhatsAppGroupInput
                label="Default Admin WhatsApp Groups"
                hint="These groups are used for admin-only routing across the whole platform unless an environment override wins."
                values={globalSettingsDraft.defaultAdminWhatsappGroups}
                onChange={(value) => setGlobalSettingsDraft((current) => ({
                  ...current,
                  defaultAdminWhatsappGroups: value,
                }))}
                onTrackAction={handleGlobalWhatsAppGroupTrack}
                namePlaceholder="Admins"
                idPlaceholder="120363404393118610"
                addLabel="Add Admin Group"
              />

                <div className="settingsGrid settingsGrid--two">
                  <TextInput
                    label="Destination Bucket"
                    hint="Shared storage bucket for processed media and the global Latest Sightings logo."
                    value={globalSettingsDraft.destBucket}
                    onChange={(value) => setGlobalSettingsDraft((current) => ({ ...current, destBucket: value }))}
                    placeholder={DEFAULT_GLOBAL_DEST_BUCKET}
                  />
                  <div className="settingsStaticField">
                    <div className="settingsStaticField__header">
                      <span className="settingsField__label">Latest Logo Path</span>
                    </div>
                    <span className="settingsField__hint">
                      Storage path inside the destination bucket. Uploading a new logo updates this automatically.
                    </span>
                    <div className="settingsStaticField__value">
                      {globalSettingsDraft.latestLogoPath || DEFAULT_GLOBAL_LATEST_LOGO_PATH}
                    </div>
                  </div>
                </div>

              <div className="settingsGlobalLogoCard">
                <div className="settingsGlobalLogoCard__preview">
                  {globalLogoPreviewUrl ? (
                    <img
                      src={globalLogoPreviewUrl}
                      alt="Latest Sightings logo preview"
                      className="settingsGlobalLogoCard__image"
                    />
                  ) : (
                    <div className="settingsGlobalLogoCard__empty">
                      <span>Preview unavailable</span>
                    </div>
                  )}
                </div>

                <div className="settingsGlobalLogoCard__content">
                  <div className="settingsGlobalLogoCard__header">
                    <strong>Latest Sightings logo</strong>
                    <span>{globalSettingsDraft.latestLogoPath || DEFAULT_GLOBAL_LATEST_LOGO_PATH}</span>
                  </div>

                  <div className="settingsInlineMeta">
                    Upload a replacement image here to update the shared logo used across every location.
                  </div>

                  {globalLogoPreviewError ? (
                    <div className="settingsInlineMeta settingsGlobalLogoCard__warning">
                      {globalLogoPreviewError}
                    </div>
                  ) : null}

                  <input
                    ref={globalLogoFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="settingsGlobalLogoCard__fileInput"
                    onChange={handleGlobalLogoFileChange}
                  />

                  <div className="settingsActionRow">
                    <button
                      type="button"
                      className="settingsButton settingsButton--ghost"
                      onClick={handleGlobalLogoPickerOpen}
                      disabled={globalLogoUploading}
                    >
                      <FiUploadCloud />
                      <span>{globalLogoUploading ? 'Uploading…' : 'Upload New Logo'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}

      {activeTab === 'users' ? (
        <div className="adminSettings__layout">
          <div className="adminSettings__rail">
            <SectionCard
              title="Users"
              description="Search accounts, then open one to manage camera access."
            >
              <div className="settingsUserRailControls">
                <TextInput
                  label="Find a user"
                  hint="Search by name, email, or user ID."
                  value={userSearchText}
                  onChange={setUserSearchText}
                  placeholder="nadav@example.com"
                />
                <SelectInput
                  label="Role filter"
                  value={userRoleFilter}
                  onChange={setUserRoleFilter}
                  options={[
                    { value: 'all', label: 'All roles' },
                    { value: 'admin', label: 'Admins' },
                    { value: 'client', label: 'Clients' },
                  ]}
                />
              </div>

              <div className="settingsUserRailSummary">
                <span>Showing {visibleUsers.length} of {filteredUsers.length} users</span>
                {filteredUsers.length > visibleUsers.length ? (
                  <span>Only {MAX_VISIBLE_USERS} users are listed at once. Search to narrow it down.</span>
                ) : null}
                {selectedUser ? <span>Editing {getUserDisplayName(selectedUser)}</span> : null}
              </div>

              <div className="settingsUserList">
                {users.length === 0 ? (
                  <div className="settingsEmptyText">No user documents found.</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="settingsEmptyText">No users match the current search.</div>
                ) : visibleUsers.map((user) => (
                  <UserAccessListItem
                    key={user.id}
                    active={selectedUserId === user.id}
                    user={user}
                    allCameraCount={allCameraIds.length}
                    allClientCount={allClientIds.length}
                    onClick={() => loadUserEditor(user, { source: 'list' })}
                  />
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="adminSettings__detail">
            <SectionCard
              title={selectedUserId ? `Access for ${getUserDisplayName(selectedUser || { id: selectedUserId })}` : 'Select a user'}
              description="Choose which cameras this user can access. The saved permissions stay the same; this layout is just tighter and easier to scan."
              stickyActions
              actions={(
                <button
                  type="button"
                  className={getSaveButtonClassName(userHasUnsavedChanges && !userSaving)}
                  onClick={saveUserAccess}
                  disabled={!selectedUserId || userSaving}
                >
                  <FiSave />
                  <span>{userSaving ? 'Saving…' : 'Save Access'}</span>
                </button>
              )}
            >
              {!selectedUserId ? (
                <div className="settingsEmptyText">Pick a user from the list first.</div>
              ) : (
                <>
                  <div className="settingsUserIdentityCard">
                    <div className="settingsUserIdentityCard__main">
                      <strong>{getUserDisplayName(selectedUser || { id: selectedUserId })}</strong>
                      {getUserSecondaryLabel(selectedUser || { id: selectedUserId }) ? (
                        <span>{getUserSecondaryLabel(selectedUser || { id: selectedUserId })}</span>
                      ) : null}
                    </div>
                    <div className="settingsUserIdentityCard__meta">
                      <span className={`settingsRoleBadge settingsRoleBadge--${userDraft.role === 'admin' ? 'admin' : 'client'}`}>
                        {userDraft.role === 'admin' ? 'Admin' : 'Client'}
                      </span>
                      <span className="settingsUserIdentityCard__id">{selectedUserId}</span>
                    </div>
                  </div>

                  <div className="settingsAccessSummaryGrid">
                    <AccessSummaryCard
                      label="Access mode"
                      value={userDraft.role === 'admin' ? 'Full admin access' : 'Limited by camera list'}
                      hint={userDraft.role === 'admin' ? 'Admins automatically inherit every camera without manual setup.' : 'Clients only see the cameras selected below.'}
                      tone={userDraft.role === 'admin' ? 'accent' : 'default'}
                    />
                    <AccessSummaryCard
                      label={userDraft.role === 'admin' ? 'Camera access' : 'Selected cameras'}
                      value={userDraft.role === 'admin' ? `All ${allCameraIds.length}` : userDraft.cameraIds.length}
                      hint={userDraft.role === 'admin' ? 'Every camera in the system is included automatically.' : (userDraft.cameraIds.length === 1 ? '1 camera assigned' : 'Cameras assigned to this user')}
                    />
                    <AccessSummaryCard
                      label={userDraft.role === 'admin' ? 'Client access' : 'Unlocked clients'}
                      value={userDraft.role === 'admin' ? `All ${allClientIds.length}` : displayedUserClientIds.length}
                      hint={userDraft.role === 'admin' ? 'No per-client setup is needed for admins.' : 'Worked out automatically from the selected cameras'}
                    />
                    <AccessSummaryCard
                      label={userDraft.role === 'admin' ? 'Manual setup' : 'Legacy extras'}
                      value={userDraft.role === 'admin' ? 'Hidden' : userDraft.manualLocationIds.length}
                      hint={userDraft.role === 'admin' ? 'Camera and fallback selection are not needed for admins.' : 'Extra location IDs kept for older screens'}
                    />
                  </div>

                  <SelectInput
                    label="Role"
                    hint="Admins bypass camera filters and can see everything."
                    value={userDraft.role}
                    onChange={(value) => setUserDraft((current) => ({ ...current, role: value }))}
                    options={[
                      { value: 'client', label: 'Client' },
                      { value: 'admin', label: 'Admin' },
                    ]}
                  />

                  <div className="settingsSectionDivider" />

                  {isSelectedUserAdmin ? (
                    <div className="settingsAdminAutoAccessNotice">
                      <strong>Admin access is automatic.</strong>
                      <p>
                        This user can already see every current camera, and new cameras will also be available without manual assignment.
                        There is nothing to pick here.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="settingsSubsection">
                        <h3 className="settingsSubheading settingsSubheading--spaced">Access to</h3>
                        <BadgeList values={displayedUserClientIds} emptyLabel="No clients derived from camera choices yet." />
                      </div>

                      <div className="settingsSectionDivider" />

                      <div className="settingsSubsection">
                        <div className="settingsUserAccessSectionHeader">
                          <div>
                            <h3 className="settingsSubheading">Camera access</h3>
                            <div className="settingsInlineMeta">
                              Find a client first, then choose the cameras under that client.
                            </div>
                          </div>
                          <div className="settingsActionRow">
                            <button
                              type="button"
                              className={`settingsButton settingsButton--ghost${showSelectedCamerasOnly ? ' settingsButton--active' : ''}`}
                              onClick={handleShowSelectedCamerasToggle}
                            >
                              {showSelectedCamerasOnly ? 'Show all cameras' : 'Show selected only'}
                            </button>
                            <button
                              type="button"
                              className="settingsButton settingsButton--ghost"
                              onClick={() => setManyUserCameras(visibleUserCameraIds, true, 'toolbar')}
                              disabled={visibleUserCameraIds.length === 0 || allVisibleUserCamerasSelected}
                            >
                              Select visible
                            </button>
                            <button
                              type="button"
                              className="settingsButton settingsButton--ghost"
                              onClick={() => setManyUserCameras(visibleUserCameraIds, false, 'toolbar')}
                              disabled={visibleUserCameraIds.length === 0 || !visibleUserCameraIds.some((cameraId) => selectedUserCameraIdSet.has(cameraId))}
                            >
                              Clear visible
                            </button>
                          </div>
                        </div>

                        <div className="settingsUserAccessFilters">
                          <TextInput
                            label="Find client"
                            hint="Search by client name."
                            value={userCameraSearchText}
                            onChange={setUserCameraSearchText}
                            placeholder="Ting Vision Location"
                          />
                        </div>

                        <div className="settingsSelectedCameraPanel">
                          <div className="settingsSelectedCameraPanel__header">
                            <div>
                              <strong>Selected cameras</strong>
                              <span>Use these quick chips to remove access without hunting through the full list.</span>
                            </div>
                            <span>{selectedUserCameraDetails.length} total</span>
                          </div>
                          {selectedUserCameraDetails.length === 0 ? (
                            <div className="settingsEmptyText">No cameras selected yet.</div>
                          ) : (
                            <div className="settingsSelectedCameraList">
                              {selectedUserCameraDetails.map((camera) => (
                                <button
                                  key={camera.id}
                                  type="button"
                                  className="settingsSelectedCameraChip"
                                  onClick={() => toggleUserCamera(camera.id, 'chip')}
                                >
                                  <strong>{camera.displayName}</strong>
                                  <span>{camera.clientName} / {camera.id}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {groupedCameras.length === 0 ? (
                          <div className="settingsEmptyText">No cameras found to assign.</div>
                        ) : filteredUserCameraGroups.length === 0 ? (
                          <div className="settingsEmptyText">No clients match the current search.</div>
                        ) : (
                          <div className="settingsUserCameraGroups">
                            {filteredUserCameraGroups.map((group) => {
                              const groupVisibleIds = group.visibleCameras.map((camera) => camera.id);
                              const allGroupVisibleSelected = groupVisibleIds.length > 0
                                && groupVisibleIds.every((cameraId) => selectedUserCameraIdSet.has(cameraId));
                              const someGroupVisibleSelected = groupVisibleIds.some((cameraId) => selectedUserCameraIdSet.has(cameraId));
                              const shouldOpenGroup = (
                                showSelectedCamerasOnly
                                || Boolean(normalizeSearchValue(userCameraSearchText))
                                || group.selectedCount > 0
                                || filteredUserCameraGroups.length <= 3
                              );

                              return (
                                <details
                                  key={group.clientId}
                                  className="settingsUserCameraGroup"
                                  open={shouldOpenGroup}
                                >
                                  <summary className="settingsUserCameraGroup__summary">
                                    <div className="settingsUserCameraGroup__title">
                                      <strong>{group.clientName}</strong>
                                      <span>{group.clientId}</span>
                                    </div>
                                  </summary>

                                  <div className="settingsUserCameraGroup__actions">
                                    <button
                                      type="button"
                                      className="settingsButton settingsButton--ghost settingsButton--small"
                                      onClick={() => setManyUserCameras(groupVisibleIds, true, 'group')}
                                      disabled={groupVisibleIds.length === 0 || allGroupVisibleSelected}
                                    >
                                      Select visible in {group.clientName}
                                    </button>
                                    <button
                                      type="button"
                                      className="settingsButton settingsButton--ghost settingsButton--small"
                                      onClick={() => setManyUserCameras(groupVisibleIds, false, 'group')}
                                      disabled={groupVisibleIds.length === 0 || !someGroupVisibleSelected}
                                    >
                                      Clear visible in {group.clientName}
                                    </button>
                                  </div>

                                  <div className="settingsUserCameraList">
                                    {group.visibleCameras.map((camera) => {
                                      const isSelected = selectedUserCameraIdSet.has(camera.id);

                                      return (
                                        <label
                                          key={camera.id}
                                          className={`settingsUserCameraRow${isSelected ? ' settingsUserCameraRow--selected' : ''}`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleUserCamera(camera.id, 'list')}
                                          />
                                          <span className="settingsUserCameraRow__content">
                                            <span className="settingsUserCameraRow__title">
                                              <strong>{camera.displayName || camera.id}</strong>
                                              {camera.siteName ? (
                                                <span className="settingsUserCameraRow__tag">{camera.siteName}</span>
                                              ) : null}
                                            </span>
                                            <span className="settingsUserCameraRow__meta">{camera.id}</span>
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </details>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="settingsSectionDivider" />

                      <TextAreaInput
                        label="Legacy extra location IDs"
                        hint="Temporary bridge for old screens that still look at locationIds. Leave blank if camera IDs are enough."
                        value={manualLocationText}
                        onChange={(value) => {
                          setManualLocationText(value);
                          setUserDraft((current) => ({
                            ...current,
                            manualLocationIds: parseIdList(value),
                          }));
                        }}
                        rows={5}
                        placeholder="garjass-house, elephant_walk_retreat"
                      />

                      <div className="settingsInlineMeta">
                        Final stored locationIds will be the selected camera IDs plus any legacy extras above.
                      </div>
                    </>
                  )}
                </>
              )}
            </SectionCard>
          </div>
        </div>
      ) : null}
        </>
      ) : null}

      {floatingSaveActions.length > 0 ? (
        <div className="settingsFloatingSaveDock" aria-live="polite">
          <div className="settingsFloatingSaveDock__panel">
            <div className="settingsFloatingSaveDock__header">
              <strong>Unsaved changes</strong>
              <span>Save from here</span>
            </div>

            <div className="settingsFloatingSaveDock__actions">
              {floatingSaveActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className="settingsButton settingsButton--attention settingsButton--floating"
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  <FiSave />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
