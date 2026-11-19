// Well-known merchants: one canonical vendor name each (so "STATE FARM RO 27 CPC-CLIENT"
// and next month's line group as one vendor), and, where the category is unambiguous for a
// small business, the standard category it belongs in.
//
// Patterns run on the upper-cased description after bank prefixes are stripped, and are
// anchored at the start so a merchant name buried in a memo doesn't match. `category` lists
// standard category names in order of preference; the first one the business has wins.
// Leave `category` off when the merchant is ambiguous (Amazon, Walmart, Apple, payroll
// processors): the vendor still groups, and the model or the user decides.

export interface Merchant {
  pattern: RegExp;
  name: string;
  vendor: string;
  category?: string[];
  /** Always show this name as the description (chains whose lines carry store codes). */
  rename?: boolean;
}

const INSURANCE = ["Insurance"];
const UTILITIES = ["Utilities", "Telephone & Internet", "Phone & Internet"];
const SOFTWARE = ["Software & Subscriptions", "Software", "Subscriptions"];
const ADS = ["Advertising & Marketing", "Advertising", "Marketing"];
const VEHICLE = ["Vehicle", "Car & Truck", "Fuel", "Auto"];
const TRAVEL = ["Travel"];
const MEALS = ["Meals", "Meals & Entertainment"];
const OFFICE = ["Office Supplies", "Supplies"];
const SHIPPING = ["Shipping & Postage", "Postage & Shipping", "Shipping", "Postage", "Office Supplies"];

const m = (pattern: RegExp, name: string, category?: string[], rename = false): Merchant =>
  ({ pattern, name, vendor: name.toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim(), category, rename });

export const MERCHANTS: Merchant[] = [
  // Ambiguous: grouped, never categorized here.
  m(/^(?:AMZN(?: MKTP)?|AMAZON(?: MKTPLACE| MARKETPLACE| MKTPL)?)\b/, "Amazon", undefined, true),
  m(/^(?:WM SUPERCENTER|WAL-?MART|WALMART)\b/, "Walmart", undefined, true),
  m(/^COSTCO(?: WHSE| WHOLESALE)?\b/, "Costco", undefined, true),

  // Insurance
  m(/^STATE ?FARM\b/, "State Farm", INSURANCE),
  m(/^GEICO\b/, "Geico", INSURANCE),
  m(/^PROGRESSIVE\b/, "Progressive", INSURANCE),
  m(/^ALLSTATE\b/, "Allstate", INSURANCE),
  m(/^NATIONWIDE\b/, "Nationwide", INSURANCE),
  m(/^LIBERTY MUTUAL\b/, "Liberty Mutual", INSURANCE),
  m(/^FARMERS INS/, "Farmers Insurance", INSURANCE),
  m(/^TRAVELERS\b/, "Travelers", INSURANCE),
  m(/^(?:THE )?HARTFORD\b/, "The Hartford", INSURANCE),
  m(/^HISCOX\b/, "Hiscox", INSURANCE),
  m(/^NEXT INSURANCE\b/, "Next Insurance", INSURANCE),
  m(/^ERIE (?:INS|INDEMNITY)/, "Erie Insurance", INSURANCE),
  m(/^THIMBLE\b/, "Thimble", INSURANCE),

  // Phone, internet, power
  m(/^VERIZON\b/, "Verizon", UTILITIES),
  m(/^(?:AT ?& ?T|ATT)\b/, "AT&T", UTILITIES),
  m(/^T-?MOBILE\b/, "T-Mobile", UTILITIES),
  m(/^(?:COMCAST|XFINITY)\b/, "Comcast", UTILITIES),
  m(/^(?:SPECTRUM|CHARTER COMM)/, "Spectrum", UTILITIES),
  m(/^COX COMM/, "Cox", UTILITIES),
  m(/^CENTURYLINK\b/, "CenturyLink", UTILITIES),
  m(/^GOOGLE ?FI\b/, "Google Fi", UTILITIES),
  m(/^DUKE ENERGY\b/, "Duke Energy", UTILITIES),
  m(/^DOMINION ENERGY\b/, "Dominion Energy", UTILITIES),
  m(/^(?:CON ED|CONEDISON|CONSOLIDATED EDISON)/, "Con Edison", UTILITIES),
  m(/^(?:PG ?& ?E|PACIFIC GAS)/, "PG&E", UTILITIES),
  m(/^GEORGIA POWER\b/, "Georgia Power", UTILITIES),

  // Software and online services
  m(/^ADOBE\b/, "Adobe", SOFTWARE),
  m(/^(?:GOOGLE ?\*? ?(?:GSUITE|WORKSPACE|G SUITE)|GSUITE)/, "Google Workspace", SOFTWARE),
  m(/^(?:MICROSOFT ?\*? ?(?:365|OFFICE)|MSFT ?\*)/, "Microsoft 365", SOFTWARE),
  m(/^DROPBOX\b/, "Dropbox", SOFTWARE),
  m(/^SLACK\b/, "Slack", SOFTWARE),
  m(/^ZOOM\.?(?:US|COM)?\b/, "Zoom", SOFTWARE),
  m(/^NOTION\b/, "Notion", SOFTWARE),
  m(/^FIGMA\b/, "Figma", SOFTWARE),
  m(/^CANVA\b/, "Canva", SOFTWARE),
  m(/^GITHUB\b/, "GitHub", SOFTWARE),
  m(/^ATLASSIAN\b/, "Atlassian", SOFTWARE),
  m(/^(?:INTUIT ?\*? ?)?QUICKBOOKS\b/, "QuickBooks", SOFTWARE),
  m(/^SHOPIFY\b/, "Shopify", SOFTWARE),
  m(/^SQUARESPACE\b/, "Squarespace", SOFTWARE),
  m(/^WIX\.?COM\b/, "Wix", SOFTWARE),
  m(/^GODADDY\b/, "GoDaddy", SOFTWARE),
  m(/^NAMECHEAP\b/, "Namecheap", SOFTWARE),
  m(/^VERCEL\b/, "Vercel", SOFTWARE),
  m(/^HEROKU\b/, "Heroku", SOFTWARE),
  m(/^(?:AWS|AMAZON WEB SERVICES)\b/, "Amazon Web Services", SOFTWARE),
  m(/^DIGITALOCEAN\b/, "DigitalOcean", SOFTWARE),
  m(/^MAILCHIMP\b/, "Mailchimp", SOFTWARE),
  m(/^HUBSPOT\b/, "HubSpot", SOFTWARE),
  m(/^DOCUSIGN\b/, "DocuSign", SOFTWARE),
  m(/^(?:OPENAI|CHATGPT)\b/, "OpenAI", SOFTWARE),
  m(/^ANTHROPIC\b/, "Anthropic", SOFTWARE),
  m(/^CALENDLY\b/, "Calendly", SOFTWARE),
  m(/^AIRTABLE\b/, "Airtable", SOFTWARE),
  m(/^ASANA\b/, "Asana", SOFTWARE),
  m(/^WEBFLOW\b/, "Webflow", SOFTWARE),
  m(/^1PASSWORD\b/, "1Password", SOFTWARE),

  // Advertising
  m(/^(?:FACEBK|FACEBOOK ADS|META ADS|META PLATFORMS)\b/, "Meta Ads", ADS),
  m(/^(?:GOOGLE ?\*? ?ADS|GOOGLE ADWORDS)/, "Google Ads", ADS),
  m(/^LINKEDIN ?\*? ?ADS?\b/, "LinkedIn Ads", ADS),
  m(/^TIKTOK ?\*? ?ADS\b/, "TikTok Ads", ADS),
  m(/^YELP\b/, "Yelp", ADS),

  // Vehicle
  m(/^SHELL(?: OIL| SERVICE)?\b/, "Shell", VEHICLE),
  m(/^EXXON(?:MOBIL)?\b/, "ExxonMobil", VEHICLE),
  m(/^CHEVRON\b/, "Chevron", VEHICLE),
  m(/^SUNOCO\b/, "Sunoco", VEHICLE),
  m(/^SPEEDWAY\b/, "Speedway", VEHICLE),
  m(/^VALERO\b/, "Valero", VEHICLE),
  m(/^MARATHON PETRO/, "Marathon", VEHICLE),
  m(/^(?:E-?Z ?PASS|SUNPASS)\b/, "Tolls", VEHICLE),
  m(/^PARKMOBILE\b/, "ParkMobile", VEHICLE),

  // Travel
  m(/^DELTA (?:AIR|AIRLINES)\b/, "Delta", TRAVEL),
  m(/^UNITED (?:AIR|AIRLINES)\b/, "United Airlines", TRAVEL),
  m(/^AMERICAN (?:AIR|AIRLINES)\b/, "American Airlines", TRAVEL),
  m(/^SOUTHWEST (?:AIR|AIRLINES)\b/, "Southwest", TRAVEL),
  m(/^JETBLUE\b/, "JetBlue", TRAVEL),
  m(/^(?:MARRIOTT|HILTON|HYATT)\b/, "Hotel", TRAVEL),
  m(/^AIRBNB\b/, "Airbnb", TRAVEL),
  m(/^EXPEDIA\b/, "Expedia", TRAVEL),
  m(/^LYFT\b/, "Lyft", TRAVEL),
  m(/^UBER EATS\b/, "Uber Eats", MEALS, true),
  m(/^UBER(?: TRIP)?\b/, "Uber", TRAVEL),

  // Meals
  m(/^DOORDASH\b/, "DoorDash", MEALS),
  m(/^GRUBHUB\b/, "Grubhub", MEALS),
  m(/^STARBUCKS\b/, "Starbucks", MEALS),
  m(/^CHIPOTLE\b/, "Chipotle", MEALS),
  m(/^PANERA\b/, "Panera", MEALS),

  // Office and shipping
  m(/^STAPLES\b/, "Staples", OFFICE),
  m(/^(?:OFFICE DEPOT|OFFICEMAX)\b/, "Office Depot", OFFICE),
  m(/^(?:USPS|US POSTAL)\b/, "USPS", SHIPPING),
  m(/^(?:UPS|THE UPS STORE)\b/, "UPS", SHIPPING),
  m(/^FEDEX\b/, "FedEx", SHIPPING),
];

/** The known merchant a description belongs to, if any. `text` is upper-cased first. */
export function findMerchant(text: string): Merchant | undefined {
  const s = text.toUpperCase().trim();
  return MERCHANTS.find((x) => x.pattern.test(s));
}
