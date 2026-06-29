#!/usr/bin/env python3
"""Sync confirmed Wimbledon singles order-of-play/results into fixtures.json.

Uses the same public GraphQL endpoint as wimbledon.com. No API key, paid service,
or chargeable fallback is used. If the official endpoint fails, the existing
fixture file is left untouched.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES_PATH = ROOT / "data" / "fixtures.json"
ENDPOINT = "https://www.wimbledon.com/graphql"

QUERY = """
query Schedule($year: Int!, $day: Int!) {
  schedule(year: $year, tournDay: $day) {
    tournDay
    courts {
      courtName courtId startEpoch
      matches {
        matchId order notBefore eventName eventCode roundName status statusCode comment courtName
        team1 { displayNameA seed won nationA }
        team2 { displayNameA seed won nationA }
        score { setsWon }
      }
    }
  }
}
"""

SLAMTRACKER_QUERY = """
query Slamtracker($year: String, $matchId: String!) {
  slamtracker(year: $year, matchId: $matchId) {
    head2head
  }
}
"""

DAYS_QUERY = """
query ScheduleDays($year: Int!) {
  scheduleDays(year: $year) {
    tournDay released
  }
}
"""

MAIN_DAYS = range(8, 22)
FEATURED_DATES = {
    "2026-06-29", "2026-06-30",
    "2026-07-01", "2026-07-02",
    "2026-07-03", "2026-07-04",
}
FEATURED_PER_TOUR = 4
SHOW_COURTS = ("Centre Court", "No. 1 Court", "No. 2 Court", "No. 3 Court")
TOUR_NAMES = {"Gentlemen's Singles": "men", "Ladies' Singles": "women"}
NATION_TO_FLAG = {
    "AUS": "🇦🇺", "AUT": "🇦🇹", "BEL": "🇧🇪", "BIH": "🇧🇦",
    "BLR": "🇧🇾", "BRA": "🇧🇷", "BUL": "🇧🇬", "CAN": "🇨🇦",
    "CHI": "🇨🇱", "CHN": "🇨🇳", "COL": "🇨🇴", "CRO": "🇭🇷",
    "CZE": "🇨🇿", "DEN": "🇩🇰", "ESP": "🇪🇸", "EST": "🇪🇪",
    "FIN": "🇫🇮", "FRA": "🇫🇷", "GBR": "🇬🇧", "GER": "🇩🇪",
    "GRE": "🇬🇷", "HUN": "🇭🇺", "IND": "🇮🇳", "IOA": "🏳️", "IRL": "🇮🇪",
    "ISR": "🇮🇱", "ITA": "🇮🇹", "JPN": "🇯🇵", "KAZ": "🇰🇿",
    "KOR": "🇰🇷", "LAT": "🇱🇻", "LTU": "🇱🇹", "MEX": "🇲🇽",
    "NED": "🇳🇱", "NOR": "🇳🇴", "NZL": "🇳🇿", "POL": "🇵🇱",
    "POR": "🇵🇹", "ROU": "🇷🇴", "RSA": "🇿🇦", "RUS": "🇷🇺",
    "SRB": "🇷🇸", "SLO": "🇸🇮", "SUI": "🇨🇭", "SVK": "🇸🇰",
    "SWE": "🇸🇪", "TUN": "🇹🇳", "TUR": "🇹🇷", "UKR": "🇺🇦",
    "URU": "🇺🇾", "USA": "🇺🇸",
}
PREDICTION_SCHEDULE = [
    ("2026-06-29", "First round", 4, 4, "featured"),
    ("2026-06-30", "First round", 4, 4, "featured"),
    ("2026-07-01", "Second round", 4, 4, "featured"),
    ("2026-07-02", "Second round", 4, 4, "featured"),
    ("2026-07-03", "Last 32", 4, 4, "featured"),
    ("2026-07-04", "Last 32", 4, 4, "featured"),
    ("2026-07-05", "Last 16", 4, 4, "all"),
    ("2026-07-06", "Last 16", 4, 4, "all"),
    ("2026-07-07", "Quarter-finals", 2, 2, "all"),
    ("2026-07-08", "Quarter-finals", 2, 2, "all"),
    ("2026-07-09", "Ladies' semi-finals", 0, 2, "all"),
    ("2026-07-10", "Gentlemen's semi-finals", 2, 0, "all"),
    ("2026-07-11", "Ladies' final", 0, 1, "all"),
    ("2026-07-12", "Gentlemen's final", 1, 0, "all"),
]


def graphql(operation: str, variables: dict, query: str) -> dict:
    body = json.dumps({
        "operationName": operation,
        "variables": variables,
        "query": query,
    }).encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"content-type": "application/json", "user-agent": "WimbledonOracle/1.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as response:
        payload = json.load(response)
    if payload.get("errors"):
        raise RuntimeError(payload["errors"][0].get("message", "official GraphQL error"))
    return payload["data"]


def request(day: int) -> dict:
    return graphql("Schedule", {"year": 2026, "day": day}, QUERY)


def flag_for(nation):
    return NATION_TO_FLAG.get(str(nation or "").upper(), "")


def surname(name):
    parts = str(name or "").split()
    return parts[-1] if parts else ""


def h2h_for(match_id):
    if not match_id:
        return None
    try:
        data = graphql("Slamtracker", {"year": "2026", "matchId": str(match_id)}, SLAMTRACKER_QUERY)
        raw = (data.get("slamtracker") or {}).get("head2head")
        if not raw:
            return None
        parsed = json.loads(raw)
        player = (parsed.get("player") or [None])[0]
        if not player:
            return None
        p1_wins = int(player.get("player1Wins") or 0)
        p2_wins = int(player.get("player2Wins") or 0)
        p1_name = player.get("player1Name") or ""
        p2_name = player.get("player2Name") or ""
        label = "H2H: first meeting"
        if p1_wins or p2_wins:
            label = f"H2H: {surname(p1_name)} {p1_wins}–{p2_wins} {surname(p2_name)}"
        return {
            "p1": p1_wins,
            "p2": p2_wins,
            "player1": p1_name,
            "player2": p2_name,
            "label": label,
        }
    except Exception:
        return None


def first_team(value):
    if isinstance(value, list):
        return value[0] if value else {}
    return value or {}


def iso_from_epoch(value):
    if not value:
        return None
    number = float(value)
    if number > 10_000_000_000:
        number /= 1000
    return dt.datetime.fromtimestamp(number, dt.timezone.utc).isoformat().replace("+00:00", "Z")


def not_before(value, date):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return iso_from_epoch(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    except ValueError:
        pass
    for fmt in ("%H:%M", "%H.%M"):
        try:
            local = dt.datetime.combine(dt.date.fromisoformat(date), dt.datetime.strptime(text, fmt).time(), tzinfo=dt.timezone(dt.timedelta(hours=1)))
            return local.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            continue
    return None


def court_rank(name):
    value = (name or "").lower()
    if "centre" in value:
        return 0
    if "no. 1" in value or "court 1" in value:
        return 1
    if "no. 2" in value or "court 2" in value:
        return 2
    if "no. 3" in value or "court 3" in value:
        return 3
    return 20


def seed_rank(item):
    seeds = [
        seed for seed in (item.get("seed1"), item.get("seed2"))
        if isinstance(seed, int) or str(seed or "").isdigit()
    ]
    return min(map(int, seeds)) if seeds else 999


def featured_sort_key(item):
    return (
        court_rank(item["court"]),
        seed_rank(item),
        item["order"],
        item["player1"],
        item["player2"],
    )


def status_for(match):
    value = f"{match.get('status', '')} {match.get('comment', '')}".lower()
    if "walkover" in value:
        return "walkover"
    if "retir" in value:
        return "retired"
    if "abandon" in value:
        return "abandoned"
    if "cancel" in value:
        return "cancelled"
    if "complete" in value or match.get("statusCode") == "D":
        return "complete"
    if any(word in value for word in ("progress", "live", "suspend")):
        return "live"
    return "upcoming"


def result_for(match):
    if status_for(match) != "complete":
        return None
    tour = TOUR_NAMES.get(match.get("eventName"))
    winning_sets = 3 if tour == "men" else 2 if tour == "women" else None
    values = (match.get("score") or {}).get("setsWon") or []
    p1, p2 = values.count(1), values.count(2)
    if winning_sets and max(p1, p2) > winning_sets:
        p1 = min(p1, winning_sets)
        p2 = min(p2, winning_sets)
    if p1 == p2 == 0:
        one, two = first_team(match.get("team1")), first_team(match.get("team2"))
        if one.get("won") is True:
            return [winning_sets or 0, 0]
        if two.get("won") is True:
            return [0, winning_sets or 0]
        return None
    return [p1, p2]


def load_existing():
    try:
        return json.loads(FIXTURES_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"fixtures": []}


def pending_slots(selected):
    selected_ids = {item["id"] for item in selected}
    slots = []
    for date, round_name, men, women, coverage in PREDICTION_SCHEDULE:
        for tour, count in (("men", men), ("women", women)):
            for index in range(1, count + 1):
                fixture_id = f"{date}-{tour}-{index}"
                if fixture_id in selected_ids:
                    continue
                slots.append({
                    "id": fixture_id,
                    "date": date,
                    "round": round_name,
                    "tour": tour,
                    "coverage": coverage,
                    "featured": coverage == "featured",
                    "time": None,
                    "startAt": None,
                    "court": None,
                    "player1": "",
                    "player2": "",
                    "seed1": None,
                    "seed2": None,
                    "status": "pending-draw",
                    "result": None,
                })
    return slots


def main():
    existing = load_existing()
    old_by_official = {
        str(item.get("officialMatchId")): item
        for item in existing.get("fixtures", [])
        if item.get("officialMatchId")
    }
    now = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    raw = []
    days_data = graphql("ScheduleDays", {"year": 2026}, DAYS_QUERY)
    released = {item["tournDay"] for item in days_data.get("scheduleDays", []) if item.get("released")}

    for day in MAIN_DAYS:
        if day not in released:
            continue
        data = request(day)
        schedule = data.get("schedule")
        if not schedule:
            continue
        for court in schedule.get("courts") or []:
            court_start = iso_from_epoch(court.get("startEpoch"))
            court_date = dt.datetime.fromisoformat(court_start.replace("Z", "+00:00")).astimezone(dt.timezone(dt.timedelta(hours=1))).date().isoformat() if court_start else None
            for match in court.get("matches") or []:
                tour = TOUR_NAMES.get(match.get("eventName"))
                if not tour or not court_date:
                    continue
                one, two = first_team(match.get("team1")), first_team(match.get("team2"))
                if not one.get("displayNameA") or not two.get("displayNameA"):
                    continue
                start_at = not_before(match.get("notBefore"), court_date)
                if not start_at and int(match.get("order") or 0) == 1:
                    start_at = court_start
                status = status_for(match)
                old = old_by_official.get(str(match.get("matchId")), {})
                lock_at = old.get("lockAt")
                if not lock_at and status != "upcoming":
                    lock_at = now
                if not lock_at and start_at:
                    start = dt.datetime.fromisoformat(start_at.replace("Z", "+00:00"))
                    if start <= dt.datetime.now(dt.timezone.utc):
                        lock_at = start_at
                raw.append({
                    "officialMatchId": str(match["matchId"]),
                    "officialDay": day,
                    "date": court_date,
                    "round": match.get("roundName") or "Singles",
                    "tour": tour,
                    "coverage": "featured" if court_date in FEATURED_DATES else "all",
                    "player1": one["displayNameA"],
                    "player2": two["displayNameA"],
                    "seed1": one.get("seed"),
                    "seed2": two.get("seed"),
                    "nation1": one.get("nationA"),
                    "nation2": two.get("nationA"),
                    "flag1": flag_for(one.get("nationA")),
                    "flag2": flag_for(two.get("nationA")),
                    "court": match.get("courtName") or court.get("courtName"),
                    "order": int(match.get("order") or 99),
                    "startAt": start_at,
                    "lockAt": lock_at,
                    "status": status,
                    "result": result_for(match),
                })

    selected = []
    for date in sorted({item["date"] for item in raw}):
        for tour in ("men", "women"):
            matches = [item for item in raw if item["date"] == date and item["tour"] == tour]
            matches.sort(key=featured_sort_key)
            if date in FEATURED_DATES:
                matches = matches[:FEATURED_PER_TOUR]
            for index, item in enumerate(matches, 1):
                item["id"] = f"{date}-{tour}-{index}"
                item.pop("order", None)
                selected.append(item)

    for item in selected:
        item["h2h"] = h2h_for(item.get("officialMatchId"))

    fixtures = selected + pending_slots(selected)
    output = {
        "updatedAt": now,
        "source": "Official Wimbledon public scores and order-of-play service",
        "sourceUrls": [
            "https://www.wimbledon.com/en_GB/scores/schedule",
            "https://www.wimbledon.com/en_GB/scores/results",
        ],
        "status": "live" if selected else "draw-pending",
        "selectionPolicy": {
            "featuredDates": sorted(FEATURED_DATES),
            "featuredPerTour": FEATURED_PER_TOUR,
            "courtPriority": list(SHOW_COURTS),
            "tieBreakers": ["seeded players", "official order of play"],
        },
        "fixtures": fixtures,
    }
    FIXTURES_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")

    api_url = os.getenv("WINDOW_API")
    secret = os.getenv("SETTLE_SECRET")
    if api_url and secret:
        overlay = {
            item["id"]: {
                "status": item["status"],
                "result": item["result"],
                "lockAt": item["lockAt"],
            }
            for item in selected
            if item["status"] != "upcoming" or item["result"] or item["lockAt"]
        }
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/settle",
            data=json.dumps({"secret": secret, "results": overlay}).encode(),
            headers={"content-type": "application/json", "user-agent": "WimbledonOracle/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError(f"settle failed: {response.status}")

    print(f"synced {len(selected)} selected singles matches from released official schedules")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"sync failed; existing data preserved by git workflow: {exc}", file=sys.stderr)
        raise
