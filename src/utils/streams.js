export const STREAMS = [
  {
    id: 'elephant-walk-retreat',
    title: 'Elephant Walk Retreat',
    baseUrl: 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/elephant-walk-retreat/index.m3u8',
    locationId: 'elephant-walk-retreat',
    aliases: ['elephant-walk-retreat', 'elephant_walk_retreat'],
  },
  {
    id: 'garjass-house',
    title: 'Garjass House',
    baseUrl: 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/garjass-house/index.m3u8',
    locationId: 'garjass-house',
    aliases: ['garjass-house', 'garjass_house'],
  },
];

export const filterStreamsByLocations = (streams, allowedLocationSet, isAdmin) => {
  if (isAdmin) {
    return streams;
  }
  if (!allowedLocationSet || allowedLocationSet.size === 0) {
    return [];
  }

  return streams.filter((stream) => {
    if (!Array.isArray(stream.aliases)) {
      return allowedLocationSet.has(stream.locationId);
    }
    return stream.aliases.some((alias) => allowedLocationSet.has(alias));
  });
};
