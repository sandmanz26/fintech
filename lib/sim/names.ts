import type { Rng } from "./random";

/** Fictional name parts. None of these collide with the mock watchlist names. */

export const FIRST_NAMES = [
  "Amara", "Ben", "Carmen", "Daniel", "Elif", "Farah", "Gabriel", "Hana", "Isaac", "Jun", "Kavya", "Leon",
  "Maya", "Nikhil", "Olivia", "Pedro", "Quinn", "Rosa", "Samuel", "Tara", "Uma", "Victor", "Wen", "Ximena",
  "Yusuf", "Zoe", "Aiko", "Bilal", "Chloe", "Dev", "Esther", "Felix", "Grace", "Hugo", "Ines", "Jonah",
  "Keira", "Luis", "Mei", "Noah", "Oscar", "Priyanka", "Rafael", "Sofia", "Theo", "Valentina", "Will", "Yara",
];

export const LAST_NAMES = [
  "Abara", "Bauer", "Castillo", "Dang", "Eriksen", "Ferreira", "Gupta", "Haddad", "Ivanova", "Jensen", "Kim",
  "Lindqvist", "Mensah", "Nakamura", "Okafor", "Park", "Quintero", "Rossi", "Santos", "Tanaka", "Usman",
  "Varga", "Watanabe", "Xu", "Yilmaz", "Zielinski", "Alvarez", "Brennan", "Chowdhury", "Delgado", "Ellis",
  "Fischer", "Garcia", "Holm", "Iyer", "Jovanovic", "Kowalski", "Laurent", "Moreau", "Nguyen", "Ortega",
  "Petrov", "Rahman", "Silva", "Thompson", "Uddin", "Vasquez", "Weber", "Young",
];

const PLACES = ["Harbor", "Copperleaf", "Northgate", "Willow", "Granite", "Bluebell", "Saltmarsh", "Juniper", "Redwood", "Lantern", "Meridian", "Foxglove", "Ironbridge", "Quarry", "Sunfield", "Tidewater", "Orchard", "Kestrel", "Marble", "Cedar", "Driftwood", "Hollow", "Ember", "Prairie", "Summit", "Thistle", "Riverbend", "Larkspur", "Beacon", "Clover"];

/** Business nouns per MCC, so a name reads like the trade. */
export const TRADE_BY_MCC: Record<string, string[]> = {
  "5411": ["Grocers", "Market", "Pantry", "Provisions"],
  "5812": ["Kitchen", "Bistro", "Noodle Bar", "Taqueria", "Eatery"],
  "5691": ["Outfitters", "Apparel", "Clothing Co."],
  "5651": ["Family Wear", "Clothiers"],
  "5999": ["General Store", "Goods", "Supply"],
  "7230": ["Barbers", "Hair Studio", "Salon"],
  "8299": ["Learning", "Academy", "Tutoring"],
  "7372": ["Software", "Labs", "Systems"],
  "5734": ["Software Store", "Apps"],
  "5977": ["Cosmetics", "Beauty Bar"],
  "5992": ["Florist", "Flower Co."],
  "7298": ["Day Spa", "Wellness"],
  "8999": ["Consulting", "Advisory"],
  "5732": ["Electronics", "Gadgets", "Audio"],
  "5968": ["Club", "Monthly", "Box"],
  "5815": ["Digital", "Downloads", "Media"],
  "7011": ["Inn", "Guesthouse", "Lodge"],
  "4121": ["Rides", "Cabs"],
  "5945": ["Toys", "Games"],
  "4722": ["Travel", "Journeys", "Tours"],
  "5967": ["Direct", "Offers"],
  "6540": ["Gift Cards", "Prepaid"],
  "5499": ["Nutrition", "Supplements", "Wellness Foods"],
  "4829": ["Remit", "Transfers"],
  "7995": ["Gaming", "Sportsbook"],
  "7273": ["Matches", "Dating"],
  "5962": ["Travel Club"],
};

export function personName(r: Rng): string {
  return `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;
}

export function businessName(r: Rng, mcc: string): { legal: string; dba: string } {
  const trade = r.pick(TRADE_BY_MCC[mcc] ?? ["Trading"]);
  const place = r.pick(PLACES);
  const dba = `${place} ${trade}`;
  const suffix = r.pick(["LLC", "Inc.", "Co.", "Ltd."]);
  return { legal: `${dba} ${suffix}`.replace("Co. Co.", "Co."), dba };
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
}
