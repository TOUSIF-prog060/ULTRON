import fs from "fs";
import path from "path";

export interface Contact {
  name: string;
  phone: string; // E.164 or local number e.g. "+1234567890" or "9876543210"
  relationship?: string; // e.g. "brother", "friend", "mom"
}

const DATA_DIR = path.join(process.cwd(), "data");
const CONTACTS_FILE = path.join(DATA_DIR, "contacts.json");

const DEFAULT_CONTACTS: Contact[] = [
  { name: "Brother", phone: "", relationship: "brother" },
  { name: "Mom", phone: "", relationship: "mom" },
  { name: "Dad", phone: "", relationship: "dad" },
  { name: "Friend", phone: "", relationship: "friend" },
];

export function getContacts(): Contact[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CONTACTS_FILE)) {
      fs.writeFileSync(CONTACTS_FILE, JSON.stringify(DEFAULT_CONTACTS, null, 2), "utf8");
      return DEFAULT_CONTACTS;
    }
    const data = fs.readFileSync(CONTACTS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading contacts:", err);
    return DEFAULT_CONTACTS;
  }
}

export function saveContacts(contacts: Contact[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2), "utf8");
  } catch (err) {
    console.error("Error saving contacts:", err);
  }
}

export function findContact(query: string): Contact | undefined {
  const contacts = getContacts();
  const q = query.toLowerCase().trim();
  return contacts.find(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.relationship && c.relationship.toLowerCase().includes(q)) ||
      c.phone.includes(q)
  );
}
