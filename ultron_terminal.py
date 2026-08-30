"""
=============================================================================
                  U.L.T.R.O.N. TERMINAL CORE ASSISTANT
  Autonomous Voice & Text Intelligence running directly in your Windows Terminal
=============================================================================
"""

import os
import sys
import json
import time
import subprocess
import threading
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
import psutil

ULTRON_API_URL = "http://localhost:3000/api/chat"
_api_reachable = None  # cached after first successful/failed call

# Speech and Audio dependencies
try:
    import speech_recognition as sr
    HAS_SR = True
except ImportError:
    HAS_SR = False

try:
    import pyttsx3
    HAS_TTS = True
except ImportError:
    HAS_TTS = False

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    from rich.table import Table
    console = Console()
except ImportError:
    console = None

# Initialize Text-To-Speech
tts_engine = None
if HAS_TTS:
    try:
        tts_engine = pyttsx3.init()
        tts_engine.setProperty('rate', 175)
        voices = tts_engine.getProperty('voices')
        for v in voices:
            if 'david' in v.name.lower() or 'english' in v.name.lower() or 'george' in v.name.lower() or 'natural' in v.name.lower():
                tts_engine.setProperty('voice', v.id)
                break
    except Exception as e:
        tts_engine = None

CONTACTS_FILE = Path(__file__).parent / "data" / "contacts.json"

APP_LAUNCH_MAP = {
    "chrome": "chrome",
    "google chrome": "chrome",
    "edge": "msedge",
    "msedge": "msedge",
    "microsoft edge": "msedge",
    "browser": "msedge",
    "firefox": "firefox",
    "brave": "brave",
    "notepad": "notepad",
    "calc": "calc",
    "calculator": "calculator:",
    "paint": "mspaint",
    "mspaint": "mspaint",
    "cmd": "cmd",
    "terminal": "wt",
    "powershell": "powershell",
    "code": "code",
    "vscode": "code",
    "vs code": "code",
    "visual studio code": "code",
    "spotify": "spotify:",
    "discord": "discord:",
    "camera": "microsoft.windows.camera:",
    "settings": "ms-settings:",
    "windows settings": "ms-settings:",
    "explorer": "explorer",
    "file explorer": "explorer",
    "my computer": "explorer",
    "this pc": "explorer",
    "files": "explorer",
    "task manager": "taskmgr",
    "taskmgr": "taskmgr",
    "control panel": "control",
    "word": "winword",
    "excel": "excel",
    "powerpoint": "powerpnt",
    "whatsapp": "https://web.whatsapp.com",
    "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com",
    "github": "https://github.com",
    "chatgpt": "https://chatgpt.com",
}


def speak_text(text: str):
    clean = text.replace("*", "").replace("#", "").replace("`", "").strip()
    if not clean:
        return

    if console:
        console.print(f"[bold cyan]ULTRON:[/bold cyan] {clean}")
    else:
        print(f"\n[ULTRON]: {clean}")

    if HAS_TTS and tts_engine:
        try:
            tts_engine.say(clean)
            tts_engine.runAndWait()
            # pyttsx3's Windows (SAPI5) driver can silently stop responding on
            # later calls if the run loop isn't explicitly closed out — stop()
            # after every utterance keeps the engine usable turn after turn.
            tts_engine.stop()
        except Exception as e:
            print(f"[TTS error: {e}]")


def get_contacts() -> list:
    if not CONTACTS_FILE.exists():
        return []
    try:
        with open(CONTACTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def launch_target_os(target: str) -> bool:
    try:
        if sys.platform == "win32":
            ps_cmd = f"powershell -NoProfile -Command \"Start-Process '{target}'\""
            subprocess.Popen(ps_cmd, shell=True)
            return True
        elif sys.platform == "darwin":
            subprocess.Popen(["open", target])
            return True
        else:
            subprocess.Popen(["xdg-open", target])
            return True
    except Exception:
        return False


def open_app_or_file(target: str) -> str:
    clean = target.lower().replace("open ", "").replace("launch ", "").replace("start ", "").strip()
    mapped = APP_LAUNCH_MAP.get(clean, target)

    ok = launch_target_os(mapped)
    if ok:
        return f"Launched {clean.title()}."
    return f"Failed to launch {target}."


def list_running_apps() -> str:
    if sys.platform != "win32":
        return "Process listing is supported on Windows."
    try:
        ps_cmd = 'powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne \'\' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress"'
        res = subprocess.check_output(ps_cmd, shell=True, text=True)
        if not res.strip():
            return "No active application windows found."
        data = json.loads(res.strip())
        if not isinstance(data, list):
            data = [data]
        lines = [f"  • {p.get('ProcessName')} (PID {p.get('Id')}): \"{p.get('MainWindowTitle')}\"" for p in data]
        return f"Active Windows ({len(data)}):\n" + "\n".join(lines)
    except Exception as e:
        return f"Error listing processes: {e}"


def close_app(target: str) -> str:
    clean = target.lower().replace("close ", "").replace("kill ", "").replace("exit ", "").strip()
    try:
        subprocess.call(f'taskkill /IM "{clean}.exe" /T', shell=True)
        return f"Closed {clean}."
    except Exception as e:
        return f"Could not close {target}: {e}"


def delete_file_soft(target_path: str) -> str:
    p = Path(target_path).resolve()
    if not p.exists():
        return f"File does not exist: {target_path}"
    try:
        escaped = str(p).replace("'", "''")
        ps_cmd = f"powershell -NoProfile -Command \"$shell = New-Object -ComObject Shell.Application; $folder = $shell.Namespace((Split-Path '{escaped}')); $item = $folder.ParseName((Split-Path '{escaped}' -Leaf)); if ($item) {{ $item.InvokeVerb('delete'); exit 0 }} else {{ exit 1 }}\""
        subprocess.call(ps_cmd, shell=True)
        return f"Moved {p.name} to Recycle Bin."
    except Exception as e:
        return f"Failed to delete {p.name}: {e}"


def search_web_or_browser(query: str, engine: str = "google") -> str:
    q = query.strip()
    if engine == "youtube" or "on youtube" in q.lower():
        clean_q = q.lower().replace("on youtube", "").strip()
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(clean_q)}"
        desc = f"YouTube for '{clean_q}'"
    elif engine == "wikipedia" or "on wikipedia" in q.lower():
        clean_q = q.lower().replace("on wikipedia", "").strip()
        url = f"https://en.wikipedia.org/wiki/Special:Search?search={urllib.parse.quote(clean_q)}"
        desc = f"Wikipedia for '{clean_q}'"
    else:
        url = f"https://www.google.com/search?q={urllib.parse.quote(q)}"
        desc = f"Google for '{q}'"

    ok = launch_target_os(url)
    if ok:
        return f"Opened browser search on {desc}."
    return f"Failed to open browser for {query}."


def search_files(query: str, root_dir: str = None, max_results: int = 10) -> str:
    if not root_dir:
        root_dir = str(Path.home())

    query_lower = query.lower().strip()
    results = []

    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "AppData", "$Recycle.Bin", "Windows")]

        for f in files:
            if query_lower in f.lower():
                results.append(os.path.join(root, f))
                if len(results) >= max_results:
                    break
        if len(results) >= max_results:
            break

    if results:
        formatted = "\n".join(f"  • {p}" for p in results)
        return f"Found {len(results)} matching file(s):\n{formatted}"
    return f"No files matching '{query}' found."


def send_whatsapp(recipient: str, message: str) -> str:
    contacts = get_contacts()
    phone = ""
    recipient_clean = recipient.lower().strip()

    for c in contacts:
        if (
            recipient_clean in c.get("name", "").lower()
            or recipient_clean in c.get("relationship", "").lower()
            or recipient_clean in c.get("phone", "")
        ):
            phone = c.get("phone", "")
            break

    if not phone and any(char.isdigit() for char in recipient):
        phone = "".join(filter(str.isdigit, recipient))

    if phone:
        phone_formatted = phone.lstrip("+")
        url = f"https://web.whatsapp.com/send?phone={phone_formatted}&text={urllib.parse.quote(message)}"
        if sys.platform == "win32":
            subprocess.Popen(f'start "" "{url}"', shell=True)
        else:
            subprocess.Popen(["xdg-open", url])
        return f"Opening WhatsApp to message {recipient.title()}."
    return f"Could not find phone number for {recipient}. Please update data/contacts.json."


def get_system_telemetry() -> str:
    mem = psutil.virtual_memory()
    cpu_percent = psutil.cpu_percent(interval=0.2)
    uptime_hours = (time.time() - psutil.boot_time()) / 3600

    return (
        f"OS: {os.name.upper()} | CPU: {psutil.cpu_count(logical=True)} Cores ({cpu_percent}% Load)\n"
        f"RAM: {mem.used / (1024**3):.1f} GB / {mem.total / (1024**3):.1f} GB ({mem.percent}% Used)\n"
        f"Uptime: {uptime_hours:.1f} hours"
    )


def call_ultron_brain(message: str, history: list = None) -> dict | None:
    """
    Routes the message through the same Gemini-powered /api/chat brain the
    web UI uses (function-calling over the full tool set: open/close apps,
    delete files, WhatsApp, web search, etc.) instead of this file's much
    narrower local regex matching. Requires `npm run dev` running in the
    project directory. Returns None if the API is unreachable so callers
    can fall back to the local engine.
    """
    global _api_reachable
    payload = json.dumps({
        "message": message,
        "history": history or [],
    }).encode("utf-8")

    req = urllib.request.Request(
        ULTRON_API_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _api_reachable = True
            return data
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        if _api_reachable is not False:
            # Only warn once per session — avoids spamming every turn while offline.
            if console:
                console.print(f"[dim]AI brain unreachable ({e}); using offline commands. Run 'npm run dev' for full Gemini responses.[/dim]")
            else:
                print(f"[AI brain unreachable ({e}); using offline commands. Run 'npm run dev' for full Gemini responses.]")
        _api_reachable = False
        return None
    except Exception as e:
        if console:
            console.print(f"[dim]AI brain error: {e}[/dim]")
        return None


def get_ultron_reply(text: str, history: list = None) -> str:
    """Try the full Gemini brain first; fall back to local regex commands offline."""
    data = call_ultron_brain(text, history)
    if data:
        # Tool results (file listings, running-app lists, etc.) live in `response`;
        # `spokenResponse` is the short natural-language line meant for TTS.
        full = data.get("response") or data.get("spokenResponse") or "Done."
        spoken = data.get("spokenResponse") or full
        if full != spoken:
            print(f"\n{full}")
        return spoken
    return process_command_local(text)


def process_command_local(cmd: str) -> str:
    text = cmd.lower().strip()

    # Greetings & banter
    if text in ("hello", "hi", "hey", "hello ultron", "hi ultron", "hey ultron"):
        return "Hello! All systems are online. How can I help you today?"
    if "how are you" in text or "how r u" in text:
        return "I'm doing great and ready to assist! What would you like to do?"
    if "who are you" in text:
        return "I am your personal AI assistant. I can open/close apps, search the web, manage files, and message contacts."

    # 1. Close Application
    if text.startswith("close ") or text.startswith("kill "):
        app = text.replace("close app", "").replace("close the app", "").replace("close", "").replace("kill", "").strip()
        return close_app(app)

    # 2. What's running
    if "what is running" in text or "whats running" in text or "running apps" in text:
        res = list_running_apps()
        print(f"\n{res}")
        return "Here are your currently open applications."

    # 3. Delete File
    if text.startswith("delete file ") or text.startswith("delete "):
        f = text.replace("delete file", "").replace("delete", "").strip()
        return delete_file_soft(f)

    # 4. Web Search
    if "open browser and search for" in text or "search for" in text or text.startswith("search ") or text.startswith("google ") or text.startswith("youtube "):
        if "file" not in text and ".txt" not in text and ".pdf" not in text:
            engine = "youtube" if "youtube" in text else "google"
            query = text
            for prefix in ["open browser and search for", "search the web for", "search for", "search google for", "search youtube for", "search", "google", "youtube"]:
                if query.startswith(prefix):
                    query = query[len(prefix):].strip()
                    break
            search_web_or_browser(query, engine)
            return f"Searching {'YouTube' if engine == 'youtube' else 'Google'} for {query} now."

    # 5. Open Applications
    if text.startswith("open ") or text.startswith("launch ") or text.startswith("start "):
        app = text
        for p in ["open the app", "open the application", "open app", "open application", "open", "launch", "start"]:
            if app.startswith(p):
                app = app[len(p):].strip()
                break
        open_app_or_file(app)
        return f"Opening {app} for you now."

    # 6. WhatsApp Message
    if "message" in text or "whatsapp" in text or "text " in text:
        recipient = "brother"
        message = "Hello, I am on my way."
        if "brother" in text:
            recipient = "brother"
        elif "mom" in text:
            recipient = "mom"
        elif "dad" in text:
            recipient = "dad"

        if "saying" in text:
            message = text.split("saying", 1)[1].strip()
        elif "that" in text:
            message = text.split("that", 1)[1].strip()
        send_whatsapp(recipient, message)
        return f"Opening WhatsApp to message your {recipient}."

    # 7. Search Files
    if "find file" in text or "search file" in text or "find all" in text or "look for file" in text:
        q = text.replace("find all files matching", "").replace("find all files named", "").replace("find files", "").replace("search files", "").replace("find file", "").replace("find all", "").strip()
        res = search_files(q)
        print(f"\n{res}")
        return "I've searched your files and displayed the results above."

    # 8. Telemetry
    if "system" in text or "telemetry" in text or "diagnostics" in text or "status" in text or "specs" in text:
        res = get_system_telemetry()
        print(f"\n{res}")
        return "Your system is running smoothly. All cores and memory are within normal limits."

    # Default response
    return "I'm on it. How else can I assist you?"


def listen_microphone(recognizer: "sr.Recognizer", mic: "sr.Microphone") -> str:
    if not HAS_SR:
        return ""
    try:
        with mic as source:
            if console:
                console.print("[bold yellow]🎙️  Listening for speech...[/bold yellow]")
            else:
                print("🎙️ Listening...")
            audio = recognizer.listen(source, timeout=6, phrase_time_limit=10)
            text = recognizer.recognize_google(audio)
            return text
    except (sr.WaitTimeoutError, sr.UnknownValueError):
        return ""
    except Exception as e:
        if console:
            console.print(f"[bold red]Mic Error: {e}[/bold red]")
        return ""


def main():
    if console:
        console.print(
            Panel(
                Text("U.L.T.R.O.N. TERMINAL INTELLIGENCE CORE\nPersonal AI Assistant on Windows", justify="center", style="bold cyan"),
                subtitle="[bold green]System Online — Natural Gemini Voice Engine[/bold green]",
                border_style="cyan",
            )
        )
    else:
        print("=== U.L.T.R.O.N. TERMINAL CORE ONLINE ===")

    call_ultron_brain("hello")  # warm probe — populates _api_reachable and prints the notice once, up front
    if _api_reachable:
        speak_text("Ultron intelligence core online, full Gemini brain connected. How may I assist you?")
    else:
        speak_text("Ultron intelligence core online in offline mode. How may I assist you?")

    recognizer = sr.Recognizer() if HAS_SR else None
    mic = None
    if HAS_SR:
        try:
            mic = sr.Microphone()
            with mic as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.8)
        except Exception:
            mic = None

    history: list = []

    def remember(user_text: str, reply_text: str):
        history.append({"role": "user", "text": user_text})
        history.append({"role": "model", "text": reply_text})
        del history[:-12]  # keep the last few turns only

    def handle_turn(user_text: str):
        reply = get_ultron_reply(user_text, history)
        speak_text(reply)
        remember(user_text, reply)

    while True:
        try:
            prompt = "\n[bold green]ULTRON >[/bold green] " if console else "\nULTRON > "
            user_input = input(prompt).strip()

            if not user_input:
                continue

            if user_input.lower() in ("exit", "quit", "q"):
                speak_text("Shutting down Ultron terminal core. Goodbye.")
                break

            if user_input.lower() in ("v", "voice"):
                if not HAS_SR or not mic:
                    print("SpeechRecognition / PyAudio is not available. Please type your directive.")
                    continue
                heard = listen_microphone(recognizer, mic)
                if heard:
                    if console:
                        console.print(f"[bold green]User (Voice):[/bold green] {heard}")
                    else:
                        print(f"User: {heard}")
                    handle_turn(heard)
                else:
                    if console:
                        console.print("[yellow]No speech detected. Ready for your next command.[/yellow]")
                continue

            if user_input.lower() == "listen":
                if not HAS_SR or not mic:
                    print("SpeechRecognition / PyAudio is not available. Please type your directive.")
                    continue
                if console:
                    console.print("[bold yellow]Continuous conversation mode — speak naturally. Say 'stop listening' or press Ctrl+C to exit.[/bold yellow]")
                else:
                    print("Continuous conversation mode — say 'stop listening' or press Ctrl+C to exit.")
                speak_text("I'm listening continuously now. Go ahead.")
                while True:
                    try:
                        heard = listen_microphone(recognizer, mic)
                        if not heard:
                            continue
                        if console:
                            console.print(f"[bold green]User (Voice):[/bold green] {heard}")
                        else:
                            print(f"User: {heard}")
                        if heard.lower() in ("stop listening", "exit voice", "cancel", "stop"):
                            speak_text("Exiting continuous listening.")
                            break
                        handle_turn(heard)
                    except KeyboardInterrupt:
                        print("\nExited continuous listening mode.")
                        break
                continue

            # Process typed command
            handle_turn(user_input)

        except KeyboardInterrupt:
            speak_text("System interrupted. Goodbye.")
            break
        except Exception as e:
            if console:
                console.print(f"[bold red]Execution error: {e}[/bold red]")
            else:
                print(f"Error: {e}")


if __name__ == "__main__":
    main()
