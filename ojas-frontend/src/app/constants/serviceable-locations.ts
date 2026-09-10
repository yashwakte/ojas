/**
 * Where Ojas currently delivers. The geofence (an admin-configured radius around
 * the warehouse) is the real enforcement; this list keeps the address form from
 * offering places we would only reject later.
 *
 * To open up a new city, add its cities here and widen the delivery radius in
 * admin → Delivery Charges. To open up a new state, add it to CITIES_BY_STATE
 * and it becomes selectable automatically.
 */
export const CITIES_BY_STATE: Readonly<Record<string, readonly string[]>> = {
  Maharashtra: ['Pune'],
};

/** States we serve, derived so the two can never drift apart. */
export const SERVICEABLE_STATES = Object.keys(CITIES_BY_STATE);

export const DEFAULT_STATE = 'Maharashtra';
export const DEFAULT_CITY = 'Pune';

export function citiesForState(state: string): readonly string[] {
  return CITIES_BY_STATE[state] ?? [];
}

/**
 * Pune's postal codes run 411001–411062. The geofence is still the real
 * enforcement (see the module comment above) — this just stops an
 * out-of-town pincode from being saved in the first place.
 */
export const PUNE_PINCODE_MIN = 411001;
export const PUNE_PINCODE_MAX = 411062;

export function isValidPunePincode(pincode: string): boolean {
  if (!/^\d{6}$/.test(pincode)) return false;
  const value = Number(pincode);
  return value >= PUNE_PINCODE_MIN && value <= PUNE_PINCODE_MAX;
}

/**
 * Why a pincode isn't accepted, in words a customer can act on — or null when there is nothing
 * to say yet.
 *
 * This exists because `isValidPunePincode` was only ever consumed as part of a "can submit"
 * boolean in three separate address forms, so typing an out-of-town pincode simply greyed the
 * button out with nothing on screen explaining why. A disabled control is not an error message;
 * the customer is left guessing which of five fields is wrong.
 *
 * Deliberately silent while the field is still being typed into — a message that appears after
 * the first keystroke and disappears on the sixth reads as a form that is arguing with you. It
 * speaks once the pincode is as long as a pincode can be, or once it contains something that
 * could never become one.
 */
export function pincodeError(pincode: string): string | null {
  const value = pincode.trim();
  if (!value) return null;

  if (/\D/.test(value)) return 'A pincode is six digits, numbers only.';
  if (value.length < 6) return null;
  if (value.length > 6) return 'A pincode is exactly six digits.';

  if (!isValidPunePincode(value)) {
    return `We deliver only in Pune at the moment, which is pincodes ${PUNE_PINCODE_MIN}–${PUNE_PINCODE_MAX}. We're expanding — please check back soon.`;
  }

  return null;
}
