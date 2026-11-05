// How big a plane is, as typical seats for its type. Layouts vary by airline, so these are rough.
// From OpenAP aircraft data (TU Delft) and Wikipedia.
const TYPE = {
  A19N: 135, A20N: 165, A21N: 200, A318: 112, A319: 125, A320: 155, A321: 190, A332: 240, A333: 270, A339: 300, A343: 270,
  A359: 325, A35K: 380, A388: 515, B37M: 146, B38M: 170, B39M: 186, B3XM: 196, B734: 152, B737: 140, B738: 176, B739: 180,
  B744: 416, B748: 470, B752: 212, B762: 216, B763: 250, B764: 245, B772: 310, B773: 380, B77L: 317, B77W: 408, B788: 235,
  B789: 275, B78X: 336, BCS1: 120, BCS3: 145, AT72: 72, AT75: 72, AT76: 72, DH8D: 78, CRJ9: 88, E145: 50, E170: 66, E75L: 71,
  E190: 94, E290: 97, E195: 102, C208: 9, C550: 8,
  GLEX: 13, GL5T: 13, GL7T: 13, GLF4: 13, GLF5: 13, GLF6: 13, G280: 8, G200: 8, CL30: 8, CL35: 8, CL60: 8, C680: 8, C68A: 8, E55P: 7,
};
const BY_CLASS = { A1: 4, A2: 8, A3: 150, A4: 212, A5: 300, A7: 4 };   // the plane's broadcast size class, when the type is unknown
export const sizeOf = p => TYPE[p.type] ?? BY_CLASS[p.cat] ?? 0;
