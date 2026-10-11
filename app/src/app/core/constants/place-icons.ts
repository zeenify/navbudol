/**
 * The place icon library — the "type" a contributor gives a place.
 *
 * These are Material Symbols Rounded names (rendered by the icon font loaded
 * in index.html). The list is deliberately broad: common categories are
 * flagged `common` and shown first in the picker; everything else is one
 * search away, so there is no limit on the kinds of places people can add.
 * The key is what the backend stores — renames would need a data migration.
 */

export interface PlaceIconDef {
  key: string;
  label: string;
  common?: boolean;
}

export const PLACE_ICONS: PlaceIconDef[] = [
  // food & drink
  { key: 'restaurant', label: 'Restaurant', common: true },
  { key: 'local_cafe', label: 'Café / Milk tea', common: true },
  { key: 'fastfood', label: 'Fast food', common: true },
  { key: 'bakery_dining', label: 'Bakery', common: true },
  { key: 'icecream', label: 'Dessert / Halo-halo' },
  { key: 'ramen_dining', label: 'Noodle house' },
  { key: 'lunch_dining', label: 'Carinderia / Eatery' },
  { key: 'dinner_dining', label: 'Dinner spot' },
  { key: 'takeout_dining', label: 'Take-out' },
  { key: 'delivery_dining', label: 'Food stall' },
  { key: 'sports_bar', label: 'Bar / Videoke' },
  { key: 'liquor', label: 'Liquor store' },
  // daily needs
  { key: 'storefront', label: 'Sari-sari store', common: true },
  { key: 'local_convenience_store', label: 'Convenience store' },
  { key: 'shopping_bag', label: 'Shop / Boutique' },
  { key: 'local_mall', label: 'Mall / Complex' },
  { key: 'grocery', label: 'Grocery', common: true },
  { key: 'laundry', label: 'Laundry shop' },
  { key: 'hardware', label: 'Hardware' },
  { key: 'devices', label: 'Gadget / Repair' },
  { key: 'print', label: 'Printing / Xerox' },
  { key: 'content_cut', label: 'Barber / Salon' },
  { key: 'spa', label: 'Spa / Massage' },
  // education
  { key: 'school', label: 'School', common: true },
  { key: 'university', label: 'University / College' },
  { key: 'menu_book', label: 'Library / Review center' },
  { key: 'toys', label: 'Day care / Playground' },
  // health
  { key: 'local_hospital', label: 'Hospital / Clinic', common: true },
  { key: 'pharmacy', label: 'Pharmacy', common: true },
  { key: 'medication', label: 'Laboratory / Med clinic' },
  { key: 'dentistry', label: 'Dental clinic' },
  { key: 'pets', label: 'Vet / Pet supply' },
  { key: 'health_and_safety', label: 'Health center', common: true },
  // government & safety
  { key: 'local_police', label: 'Police station', common: true },
  { key: 'local_fire_department', label: 'Fire station' },
  { key: 'account_balance', label: 'Town hall / Government', common: true },
  { key: 'gavel', label: 'Courtyard / Hall' },
  { key: 'local_atm', label: 'ATM', common: true },
  { key: 'savings', label: 'Bank / Pawnshop' },
  { key: 'mail', label: 'Post office' },
  // faith
  { key: 'church', label: 'Church', common: true },
  { key: 'mosque', label: 'Mosque' },
  { key: 'temple_buddhist', label: 'Temple' },
  // transport
  { key: 'local_gas_station', label: 'Gas station', common: true },
  { key: 'ev_station', label: 'Charging station' },
  { key: 'local_parking', label: 'Parking' },
  { key: 'directions_bus', label: 'Jeepney / Bus stop' },
  { key: 'local_taxi', label: 'Tricycle / Taxi hub' },
  { key: 'two_wheeler', label: 'Motorshop / Ride hub' },
  { key: 'car_repair', label: 'Vulcanizing / Mechanic' },
  { key: 'flight', label: 'Terminal / Airport' },
  { key: 'anchor', label: 'Port / Wharf' },
  // leisure & nature
  { key: 'park', label: 'Park / Plaza', common: true },
  { key: 'forest', label: 'Mountain / Forest' },
  { key: 'water', label: 'River / Falls / Spring', common: true },
  { key: 'beach_access', label: 'Beach / Resort', common: true },
  { key: 'pool', label: 'Swimming pool' },
  { key: 'camping', label: 'Campsite' },
  { key: 'fitness_center', label: 'Gym' },
  { key: 'sports_tennis', label: 'Court / Sports' },
  { key: 'sports_esports', label: 'Computer shop' },
  { key: 'museum', label: 'Museum / Heritage' },
  { key: 'movie', label: 'Cinema' },
  { key: 'theater_comedy', label: 'Events hall' },
  { key: 'music_note', label: 'Music / Studio' },
  { key: 'attractions', label: 'Tourist spot' },
  { key: 'festival', label: 'Festival ground' },
  // stays
  { key: 'hotel', label: 'Hotel / Resort', common: true },
  { key: 'bed', label: 'Transient / Lodging' },
  { key: 'cottage', label: 'Nipa hut / Rest house' },
  { key: 'apartment', label: 'Apartment / Dorm' },
  // work & farm
  { key: 'business_center', label: 'Office' },
  { key: 'factory', label: 'Factory / Workshop' },
  { key: 'warehouse', label: 'Warehouse / Bodega' },
  { key: 'agriculture', label: 'Farm / Bakod', common: true },
  { key: 'eco', label: 'Garden / Nursery' },
  { key: 'construction', label: 'Construction site' },
  // services
  { key: 'build', label: 'Service shop' },
  { key: 'plumbing', label: 'Plumber' },
  { key: 'electrical_services', label: 'Electrician' },
  { key: 'cleaning_services', label: 'Cleaning service' },
  { key: 'engineering', label: 'Engineering office' },
  { key: 'camera', label: 'Photo / Studio' },
  { key: 'cell_tower', label: 'Signal / Tower' },
  { key: 'wifi', label: 'Wifi spot' },
  { key: 'cake', label: 'Cake shop' },
  { key: 'redeem', label: 'Gift shop' },
  { key: 'event', label: 'Venue' },
  { key: 'palette', label: 'Art space' },
  { key: 'casino', label: 'Games / Arcade' },
  { key: 'star', label: 'Landmark' },
];

/** The shortcut grid shown before searching (order matters visually). */
export const COMMON_PLACE_ICONS = PLACE_ICONS.filter((i) => i.common);

export function placeIconDef(key: string): PlaceIconDef | null {
  return PLACE_ICONS.find((i) => i.key === key) ?? null;
}

export function searchPlaceIcons(query: string): PlaceIconDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return PLACE_ICONS;
  return PLACE_ICONS.filter(
    (i) => i.label.toLowerCase().includes(q) || i.key.replace(/_/g, ' ').includes(q)
  );
}
