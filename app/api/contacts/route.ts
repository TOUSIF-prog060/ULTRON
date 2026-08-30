import { NextRequest, NextResponse } from "next/server";
import { getContacts, saveContacts, type Contact } from "@/lib/tools/contacts";

export async function GET() {
  const contacts = getContacts();
  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (Array.isArray(body.contacts)) {
      saveContacts(body.contacts);
      return NextResponse.json({ success: true, contacts: body.contacts });
    }
    return NextResponse.json({ error: "Invalid contacts array" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
