import { NextRequest, NextResponse } from "next/server";
import {
  memorySnapshot,
  addFact,
  addCorrection,
  setProfileKey,
  forgetFact,
} from "@/lib/memory/store";

export async function GET() {
  return NextResponse.json(memorySnapshot());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    switch (body.action) {
      case "add_fact":
        return NextResponse.json({ ok: true, fact: addFact(String(body.text || ""), { tags: body.tags, source: "user" }) });
      case "add_correction":
        return NextResponse.json({ ok: true, correction: addCorrection(String(body.mistake || ""), String(body.correction || ""), body.context) });
      case "set_profile":
        return NextResponse.json({ ok: true, profile: setProfileKey(String(body.key), body.value) });
      case "forget":
        return NextResponse.json({ ok: forgetFact(String(body.query || "")) });
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
