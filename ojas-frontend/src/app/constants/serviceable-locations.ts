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
