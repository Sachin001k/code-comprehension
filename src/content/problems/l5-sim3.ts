import type { Problem } from '../types';

/**
 * L5 full interview simulations: Apple-style photo dedup (no AI) and
 * BlackRock-style historical VaR engine.
 */
const problems: Problem[] = [
  {
    id: "l5-sim-apple-photo-dedup",
    title: "Photos: Near-Duplicate Merge (No-AI Round)",
    level: 5,
    rating: 2550,
    lang: "python",
    domain: "search",
    companies: ["apple"],
    tags: [
      "interview-simulation",
      "perceptual-hash",
      "union-find",
      "pigeonhole",
      "timezones",
      "no-ai",
    ],
    summary: "A dHash + banded-index dedup job silently splits groups and misses near-duplicates. Trace it, fix it, then add tripod-shot protection.",
    context: `**Apple-style IDE round, no AI assistant.** 7 stages, one codebase, ~60 minutes. You have an editor and a terminal, nothing else.

You have joined the Photos team. The overnight *near-duplicate merge* job proposes groups of near-identical pictures, keeps the best one and folds the others' metadata (keywords, rating, favourite, GPS) into it. QA attached \`data/catalog.json\` to a radar: "the six shots from the sunset burst (IMG_2001-2005 and IMG_2008) should be one group; the job proposes two, and IMG_2008 is not proposed at all".

Expect the interviewer to ask you to *explain* each step out loud. Everything you need is in the repo: start with the README, then follow \`main.py\`.`,
    persona: "helpful-senior",
    files: [
      {
        path: "README.md",
        content: `# photolib-dedup

Duplicate detection for the on-device photo library. Runs after import on
the background-processing queue and proposes *merge groups*: one keeper per
group, with metadata (keywords, rating, favourite, GPS, albums) folded in
from the duplicates before they are moved to Recently Deleted.

## Pipeline

1. \`catalog.load_catalog\` reads the export written by the importer. Every
   photo already carries a 64-bit **dHash** (\`phash\`) computed at import
   time by \`importer.hash_image\` (see \`imaging.py\`, \`phash.py\`).
2. \`pipeline.find_duplicates\` drops thumbnails below \`MIN_DIMENSION\`.
3. \`index.near_pairs\` uses a multi-index (banded) hash table to find
   candidate pairs, then verifies the real Hamming distance against
   \`HAMMING_THRESHOLD\`.
4. \`cluster.clusters\` groups pairs transitively with a disjoint-set.
5. \`merge.merge_group\` picks the keeper and merges metadata.
6. \`report.render\` prints the plan.

\`jobs.IncrementalDeduper\` is the cheap variant the background queue runs
after each import batch: it keeps one \`BandIndex\` alive and only checks
the new arrivals.

\`\`\`
python3 main.py            # dry-run plan for data/catalog.json
python3 -m pytest tests    # unit tests
\`\`\`

## Conventions

* Hashes are unsigned 64-bit ints. SQLite hands them back signed; always
  pass through \`phash.from_signed\`.
* Capture times are EXIF local time plus \`OffsetTimeOriginal\`. Compare
  instants, never the raw strings (\`exif.capture_instant\`).
* Keeper policy: most pixels, then edited, then largest file, then earliest
  capture, then lowest id. Deterministic by design: re-running the job must
  propose the same keeper.

## Known gaps

* No guard against "tripod shots": two pictures of the same static scene
  taken hours apart hash identically and get merged (PHOTOS-4471).
* Albums are not merged yet: duplicates' album memberships are lost.
`,
        language: "markdown",
      },
      {
        path: "pyproject.toml",
        content: `[project]
name = "photolib-dedup"
version = "0.9.2"
requires-python = ">=3.10"
description = "Near-duplicate detection and metadata merge for the photo library"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q"

[tool.photolib]
# Overrides read by ops tooling only; the job itself uses photolib/config.py
catalog = "data/catalog.json"
dry_run = true
`,
        language: "text",
      },
      {
        path: "main.py",
        content: `"""Dry-run the dedup job against the bundled catalog."""
import os

from photolib.catalog import load_catalog
from photolib.pipeline import find_duplicates
from photolib.report import render

HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == "__main__":
    photos = load_catalog(os.path.join(HERE, "data", "catalog.json"))
    print(render(find_duplicates(photos)))
`,
      },
      {
        path: "photolib/__init__.py",
        content: `"""Near-duplicate detection for the photo library."""

__all__ = ["config", "models", "pipeline"]
__version__ = "0.9.2"
`,
      },
      {
        path: "photolib/config.py",
        content: `"""Tunables for the duplicate detector.

These mirror the values shipped with the 9.2 import settings. Changing
HASH_BITS requires re-hashing the entire library.
"""

HASH_BITS = 64

# Two hashes within this many differing bits are treated as the same picture.
HAMMING_THRESHOLD = 6

# The candidate index splits every hash into BANDS equal slices and only
# compares photos that agree exactly on at least one slice.
BANDS = 4

# Thumbnails / stickers / icons smaller than this (shortest side) are ignored.
MIN_DIMENSION = 64

# Used when a photo has a capture time but no OffsetTimeOriginal tag.
DEFAULT_TZ_OFFSET = "+00:00"
`,
      },
      {
        path: "photolib/models.py",
        content: `from dataclasses import dataclass, field
from typing import List, Optional, Tuple


@dataclass
class Photo:
    id: str
    width: int
    height: int
    size_bytes: int
    phash: int
    taken_at: Optional[str] = None      # EXIF DateTimeOriginal "YYYY:MM:DD HH:MM:SS" (local)
    tz_offset: Optional[str] = None     # EXIF OffsetTimeOriginal "+02:00"
    camera: Optional[str] = None
    gps: Optional[Tuple[float, float]] = None
    keywords: List[str] = field(default_factory=list)
    albums: List[str] = field(default_factory=list)
    rating: int = 0
    favorite: bool = False
    edited: bool = False

    @property
    def pixels(self) -> int:
        return self.width * self.height


@dataclass
class DuplicateGroup:
    keeper: Photo
    duplicates: List[Photo]
    merged: Photo

    @property
    def members(self) -> List[Photo]:
        return [self.keeper] + self.duplicates


@dataclass
class DedupResult:
    groups: List[DuplicateGroup]
    untouched: List[Photo]
    skipped: List[Photo]
`,
      },
      {
        path: "photolib/catalog.py",
        content: `"""Load the importer's JSON export into Photo objects."""
import json

from .models import Photo
from .phash import from_hex, from_signed


def _hash(raw):
    if isinstance(raw, str):
        return from_hex(raw)
    return from_signed(int(raw))


def photo_from_dict(d):
    return Photo(
        id=d["id"],
        width=d["width"],
        height=d["height"],
        size_bytes=d.get("size_bytes", 0),
        phash=_hash(d["phash"]),
        taken_at=d.get("taken_at"),
        tz_offset=d.get("tz_offset"),
        camera=d.get("camera"),
        gps=tuple(d["gps"]) if d.get("gps") else None,
        keywords=list(d.get("keywords", [])),
        albums=list(d.get("albums", [])),
        rating=d.get("rating", 0),
        favorite=d.get("favorite", False),
        edited=d.get("edited", False),
    )


def load_catalog(path):
    with open(path) as fh:
        return [photo_from_dict(d) for d in json.load(fh)]
`,
      },
      {
        path: "photolib/pipeline.py",
        content: `"""The dedup job: filter -> candidate pairs -> clusters -> merge."""
from .cluster import clusters
from .config import HAMMING_THRESHOLD, MIN_DIMENSION
from .index import near_pairs
from .merge import merge_group
from .models import DedupResult, DuplicateGroup


def is_eligible(p):
    return min(p.width, p.height) >= MIN_DIMENSION


def find_duplicates(photos, threshold=HAMMING_THRESHOLD):
    eligible = [p for p in photos if is_eligible(p)]
    skipped = [p for p in photos if not is_eligible(p)]

    pairs = near_pairs(eligible, threshold)
    groups = []
    grouped = set()
    for idxs in clusters(len(eligible), pairs):
        members = [eligible[i] for i in idxs]
        keeper, dups, merged = merge_group(members)
        groups.append(DuplicateGroup(keeper=keeper, duplicates=dups, merged=merged))
        grouped.update(idxs)

    untouched = [p for i, p in enumerate(eligible) if i not in grouped]
    return DedupResult(groups=groups, untouched=untouched, skipped=skipped)
`,
      },
      {
        path: "photolib/index.py",
        content: `"""Candidate generation via multi-index hashing.

Comparing every pair of photos is O(n^2); a 60k-photo library would need
1.8 billion Hamming distances. Instead each 64-bit hash is cut into
\`bands\` equal slices and stored in one hash table per slice. Two photos
are *candidates* when they agree exactly on at least one slice; only
candidates get a real Hamming check.
"""
from collections import defaultdict

from .config import BANDS, HASH_BITS
from .phash import hamming


class BandIndex:
    def __init__(self, bands=BANDS, bits=HASH_BITS):
        if bits % bands:
            raise ValueError("bits must divide evenly into bands")
        self.bands = bands
        self.width = bits // bands
        self.mask = (1 << self.width) - 1
        self.tables = [defaultdict(list) for _ in range(bands)]
        self.size = 0

    def _slices(self, h):
        return [(h >> (i * self.width)) & self.mask for i in range(self.bands)]

    def add(self, key, h):
        for i, s in enumerate(self._slices(h)):
            self.tables[i][s].append((key, h))
        self.size += 1

    def candidates(self, h):
        """Return {key: hash} for every stored photo sharing a slice with h.
        A dict, so a photo matching on several slices is reported once."""
        seen = {}
        for i, s in enumerate(self._slices(h)):
            for key, other in self.tables[i].get(s, ()):
                seen[key] = other
        return seen


def near_pairs(photos, threshold, bands=BANDS):
    """Yield (i, j, distance) with i < j for every pair of photos whose
    hashes are within \`threshold\` bits. Indices refer to \`photos\`."""
    index = BandIndex(bands)
    pos = {}
    for j, p in enumerate(photos):
        for key, other in index.candidates(p.phash).items():
            d = hamming(p.phash, other)
            if d <= threshold:
                yield pos[key], j, d
        index.add(p.id, p.phash)
        pos[p.id] = j
`,
      },
      {
        path: "photolib/cluster.py",
        content: `"""Transitive grouping of near-duplicate pairs."""
from collections import defaultdict


class DisjointSet:
    """Union-find with union by size and path compression."""

    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        # Path compression: point every node on the walk straight at root.
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[b] = ra
        self.size[ra] += self.size[rb]
        return True


def clusters(n, pairs):
    """Return groups (lists of indices, ascending) with at least two members,
    ordered by their smallest index."""
    ds = DisjointSet(n)
    for i, j, _ in pairs:
        ds.union(i, j)
    groups = defaultdict(list)
    for i in range(n):
        groups[ds.find(i)].append(i)
    return sorted((g for g in groups.values() if len(g) > 1), key=lambda g: g[0])
`,
      },
      {
        path: "photolib/merge.py",
        content: `"""Keeper selection and metadata merge for one duplicate group."""
from dataclasses import replace

from .exif import capture_instant


def choose_keeper(photos):
    """Most pixels wins; then an edited version; then the larger file; then
    the earliest capture; finally the lowest id (determinism)."""
    def key(p):
        inst = capture_instant(p)
        ts = inst.timestamp() if inst else float("inf")
        return (-p.pixels, not p.edited, -p.size_bytes, ts, p.id)
    return min(photos, key=key)


def _merge_keywords(keeper, others):
    """Case-insensitive union. The keeper's spelling and order come first,
    then new keywords in the order the other photos are listed."""
    out = []
    seen = set()
    for p in [keeper] + others:
        for kw in p.keywords:
            k = kw.casefold()
            if k not in seen:
                seen.add(k)
                out.append(kw)
    return out


def _earliest(photos):
    dated = [(capture_instant(p), p) for p in photos]
    dated = [(i, p) for i, p in dated if i is not None]
    if not dated:
        return None
    return min(dated, key=lambda t: t[0])[1]


def merge_group(photos):
    """Return (keeper, duplicates, merged) where \`merged\` is a copy of the
    keeper carrying the union of everyone's metadata."""
    keeper = choose_keeper(photos)
    others = [p for p in photos if p is not keeper]
    first = _earliest(photos)
    gps = keeper.gps
    if gps is None:
        gps = next((p.gps for p in others if p.gps is not None), None)
    merged = replace(
        keeper,
        keywords=_merge_keywords(keeper, others),
        rating=max(p.rating for p in photos),
        favorite=any(p.favorite for p in photos),
        gps=gps,
        taken_at=first.taken_at if first else keeper.taken_at,
        tz_offset=first.tz_offset if first else keeper.tz_offset,
    )
    return keeper, others, merged
`,
      },
      {
        path: "photolib/exif.py",
        content: `"""EXIF date handling.

DateTimeOriginal is *local* wall-clock time with no zone. Newer cameras
add OffsetTimeOriginal ("+02:00"). Two photos of the same moment taken in
different zones (or re-exported by an app that rewrote the local time)
must compare equal, so everything is normalised to a UTC instant.
"""
from datetime import datetime, timedelta, timezone

from .config import DEFAULT_TZ_OFFSET

EXIF_FORMAT = "%Y:%m:%d %H:%M:%S"


def parse_offset(s):
    """'+05:30' -> timedelta(hours=5, minutes=30); '-03:00' -> -3h."""
    sign = -1 if s[0] == "-" else 1
    hh, mm = s[1:].split(":")
    return sign * timedelta(hours=int(hh), minutes=int(mm))


def capture_instant(photo):
    """Aware UTC datetime for when the shutter fired, or None if unknown."""
    if not photo.taken_at or photo.taken_at.startswith("0000"):
        return None
    local = datetime.strptime(photo.taken_at, EXIF_FORMAT)
    offset = parse_offset(photo.tz_offset or DEFAULT_TZ_OFFSET)
    return local.replace(tzinfo=timezone(offset)).astimezone(timezone.utc)


def seconds_between(a, b):
    """Absolute gap in seconds between two photos' capture instants,
    or None if either is undated."""
    ia, ib = capture_instant(a), capture_instant(b)
    if ia is None or ib is None:
        return None
    return abs((ia - ib).total_seconds())
`,
      },
      {
        path: "photolib/phash.py",
        content: `"""Perceptual hashing (dHash) and bit helpers."""
from .imaging import resize

MASK64 = 0xFFFFFFFFFFFFFFFF


def dhash(gray):
    """Difference hash.

    Shrink to 9x8 and record, for each of the 8 comparisons per row,
    whether a pixel is brighter than its right-hand neighbour.
    Row-major, most significant bit first -> 64 bits.
    """
    small = resize(gray, 9, 8)
    bits = 0
    for row in small:
        for x in range(8):
            bits = (bits << 1) | (1 if row[x] > row[x + 1] else 0)
    return bits


def hamming(a, b):
    return bin(a ^ b).count("1")


def to_hex(h):
    return format(h & MASK64, "016x")


def from_hex(s):
    return int(s, 16)


def from_signed(v):
    """SQLite stores INTEGER as signed 64-bit, so hashes with the top bit set
    come back negative. Masking restores the unsigned value."""
    return v & MASK64
`,
      },
      {
        path: "photolib/imaging.py",
        content: `"""Tiny pure-Python image helpers used by the importer.

Images are lists of rows. RGB images hold (r, g, b) tuples, grayscale
images hold ints 0..255 (or floats after resizing).
"""


def luminance(r, g, b):
    # ITU-R BT.601 luma. Integer maths so we match the C importer bit-for-bit.
    return (299 * r + 587 * g + 114 * b) // 1000


def to_grayscale(rgb_rows):
    return [[luminance(*px) for px in row] for row in rgb_rows]


def dimensions(img):
    return (len(img[0]) if img else 0, len(img))


def resize(gray, out_w, out_h):
    """Box-filter downscale.

    Output pixel (ox, oy) is the mean of the source block
    [x0, x1) x [y0, y1). When upscaling, a block is at least one pixel.
    """
    in_w, in_h = dimensions(gray)
    if in_w == 0 or in_h == 0:
        raise ValueError("empty image")
    out = []
    for oy in range(out_h):
        y0 = oy * in_h // out_h
        y1 = max(y0 + 1, (oy + 1) * in_h // out_h)
        row = []
        for ox in range(out_w):
            x0 = ox * in_w // out_w
            x1 = max(x0 + 1, (ox + 1) * in_w // out_w)
            total = 0
            count = 0
            for y in range(y0, y1):
                src = gray[y]
                for x in range(x0, x1):
                    total += src[x]
                    count += 1
            row.append(total / count)
        out.append(row)
    return out


def crop(gray, left, top, width, height):
    return [row[left:left + width] for row in gray[top:top + height]]
`,
      },
      {
        path: "photolib/importer.py",
        content: `"""Hashing performed at import time (not during the dedup job)."""
from .imaging import to_grayscale, dimensions
from .phash import dhash


def hash_image(rgb_rows):
    """Return (width, height, phash) for an RGB image."""
    gray = to_grayscale(rgb_rows)
    w, h = dimensions(gray)
    return w, h, dhash(gray)


def gradient(width, height, step=1, offset=0):
    """Synthetic RGB fixture: brightness falls left to right."""
    rows = []
    for y in range(height):
        row = []
        for x in range(width):
            v = max(0, min(255, 255 - (x * step + offset + y) % 256))
            row.append((v, v, v))
        rows.append(row)
    return rows
`,
      },
      {
        path: "photolib/jobs.py",
        content: `"""Incremental dedup, run by the background-processing queue after every
import batch.

The full job (pipeline.find_duplicates) re-indexes the whole library; at
60k photos that is ~9 s of CPU, too much to run after every AirDrop. This
keeps one BandIndex alive for the lifetime of the queue worker and only
hashes-in the new arrivals (~40 ms per batch).
"""
from .config import HAMMING_THRESHOLD
from .index import BandIndex
from .phash import hamming


class IncrementalDeduper:
    def __init__(self, threshold=HAMMING_THRESHOLD):
        self.threshold = threshold
        self.index = BandIndex()
        self.known = {}          # id -> Photo, everything indexed so far
        self.batches = 0

    def seed(self, library):
        """Index the existing library once, when the worker starts."""
        for p in library:
            self._remember(p)

    def _remember(self, p):
        self.index.add(p.id, p.phash)
        self.known[p.id] = p

    def ingest(self, batch):
        """Return [(earlier_id, new_id, distance)] for every new photo that
        duplicates something already in the library *or earlier in this
        batch*. Safe to call twice with the same batch (queue redelivery)."""
        self.batches += 1
        found = []
        for p in batch:
            if p.id in self.known:
                continue  # redelivered by the queue: already reported
            for key, other in self.index.candidates(p.phash).items():
                d = hamming(p.phash, other)
                if d <= self.threshold:
                    found.append((key, p.id, d))
        for p in batch:
            if p.id not in self.known:
                self._remember(p)
        return found

    def stats(self):
        return {"indexed": self.index.size, "batches": self.batches}
`,
      },
      {
        path: "photolib/report.py",
        content: `"""Plain-text rendering of a dedup plan."""


def render(result):
    lines = [
        "eligible=%d skipped=%d groups=%d"
        % (sum(len(g.members) for g in result.groups) + len(result.untouched),
           len(result.skipped), len(result.groups))
    ]
    for g in result.groups:
        ids = sorted(p.id for p in g.members)
        lines.append("group keeper=%s members=%s rating=%d fav=%s"
                     % (g.keeper.id, ",".join(ids), g.merged.rating, g.merged.favorite))
    lines.append("untouched=" + ",".join(p.id for p in result.untouched))
    return "\\n".join(lines)
`,
      },
      {
        path: "data/catalog.json",
        content: `[
  {"id": "IMG_2001", "width": 4032, "height": 3024, "size_bytes": 3104512, "phash": "1111222233334444",
   "taken_at": "2024:07:14 18:22:05", "tz_offset": "+02:00", "camera": "iPhone 15 Pro",
   "gps": [43.7102, 7.2620], "keywords": ["Beach", "sunset"], "albums": ["Nice 2024"], "rating": 3},
  {"id": "IMG_2002", "width": 1024, "height": 768, "size_bytes": 402113, "phash": "1111222233334445",
   "taken_at": "2024:07:14 16:22:05", "tz_offset": "+00:00", "keywords": ["beach", "Family"],
   "albums": ["Shared: Mum"], "rating": 5, "favorite": true},
  {"id": "IMG_2003", "width": 4032, "height": 3024, "size_bytes": 2988001, "phash": "1111222233cc4444",
   "taken_at": "2024:07:14 18:22:09", "tz_offset": "+02:00", "camera": "iPhone 15 Pro", "rating": 0},
  {"id": "IMG_2004", "width": 4032, "height": 3024, "size_bytes": 3011870, "phash": "1111222233cc4446",
   "taken_at": "2024:07:14 18:22:09", "tz_offset": "+02:00", "camera": "iPhone 15 Pro",
   "keywords": ["sunset"], "rating": 4, "edited": true},
  {"id": "IMG_2005", "width": 2048, "height": 1536, "size_bytes": 880400, "phash": "11112222333c4444",
   "taken_at": "2024:07:14 18:22:07", "tz_offset": "+02:00", "rating": 1},
  {"id": "IMG_2006", "width": 48, "height": 48, "size_bytes": 2210, "phash": "1111222233334444",
   "keywords": ["sticker"]},
  {"id": "IMG_2007", "width": 3024, "height": 4032, "size_bytes": 2500144, "phash": "8e3f0a7c51d2b964",
   "taken_at": "2024:07:15 09:01:44", "tz_offset": "+02:00", "rating": 2},
  {"id": "IMG_2008", "width": 4032, "height": 3024, "size_bytes": 3050007, "phash": "1110222333324454",
   "taken_at": "2024:07:14 18:22:06", "tz_offset": "+02:00", "camera": "iPhone 15 Pro", "rating": 2}
]
`,
        language: "json",
      },
      {
        path: "tests/test_phash.py",
        content: `from photolib.importer import gradient, hash_image
from photolib.phash import dhash, from_signed, hamming, to_hex
from photolib.imaging import to_grayscale


def test_gradient_hash_is_all_ones():
    # brightness falls left to right, so every pixel beats its right neighbour
    w, h, ph = hash_image(gradient(90, 80, step=2))
    assert (w, h) == (90, 80)
    assert ph == 0xFFFFFFFFFFFFFFFF


def test_flat_image_hash_is_zero():
    flat = to_grayscale([[(120, 120, 120)] * 32 for _ in range(32)])
    assert dhash(flat) == 0


def test_hamming():
    assert hamming(0b1011, 0b0010) == 2
    assert hamming(0, 0xFFFFFFFFFFFFFFFF) == 64


def test_signed_round_trip():
    assert from_signed(-1) == 0xFFFFFFFFFFFFFFFF
    assert to_hex(from_signed(-2)) == "fffffffffffffffe"
`,
      },
      {
        path: "tests/test_merge.py",
        content: `from photolib.models import Photo
from photolib.merge import choose_keeper, merge_group


def P(id, **kw):
    base = dict(width=4032, height=3024, size_bytes=1000, phash=0)
    base.update(kw)
    return Photo(id=id, **base)


def test_keeper_prefers_resolution_then_edit():
    a = P("a", width=1024, height=768, edited=True)
    b = P("b")
    c = P("c", edited=True)
    assert choose_keeper([a, b, c]).id == "c"


def test_keywords_case_insensitive_union():
    a = P("a", keywords=["Beach", "sunset"], size_bytes=9999)
    b = P("b", keywords=["beach", "Family"])
    keeper, dups, merged = merge_group([b, a])
    assert keeper.id == "a"
    assert merged.keywords == ["Beach", "sunset", "Family"]


def test_earliest_capture_is_kept():
    a = P("a", taken_at="2024:07:14 18:22:05", tz_offset="+02:00", size_bytes=9999)
    b = P("b", taken_at="2024:07:14 16:22:04", tz_offset="+00:00")
    _, _, merged = merge_group([a, b])
    assert merged.taken_at == "2024:07:14 16:22:04"
`,
      },
      {
        path: "tests/test_pipeline.py",
        content: `from photolib.models import Photo
from photolib.pipeline import find_duplicates


def P(id, phash, **kw):
    base = dict(width=4032, height=3024, size_bytes=1000)
    base.update(kw)
    return Photo(id=id, phash=phash, **base)


def test_simple_chain_is_one_group():
    # a~b and b~c (3 bits each) but a and c are 6 bits apart: still one group
    a = P("a", 0x0000000000000000)
    b = P("b", 0x0000000000000007)
    c = P("c", 0x000000000000003F)
    res = find_duplicates([a, b, c])
    assert len(res.groups) == 1
    assert sorted(p.id for p in res.groups[0].members) == ["a", "b", "c"]


def test_icons_are_skipped():
    res = find_duplicates([P("icon", 0, width=32, height=32), P("x", 0)])
    assert [p.id for p in res.skipped] == ["icon"]
    assert [p.id for p in res.untouched] == ["x"]
`,
      },
      {
        path: "tests/test_jobs.py",
        content: `from photolib.jobs import IncrementalDeduper
from photolib.models import Photo


def P(id, phash):
    return Photo(id=id, width=4032, height=3024, size_bytes=1, phash=phash)


def test_new_photo_matches_library():
    job = IncrementalDeduper()
    job.seed([P("old", 0xABCDEF0123456789)])
    found = job.ingest([P("new", 0xABCDEF0123456788)])
    assert found == [("old", "new", 1)]


def test_redelivery_is_idempotent():
    job = IncrementalDeduper()
    job.seed([P("old", 0xABCDEF0123456789)])
    batch = [P("new", 0xABCDEF0123456788)]
    job.ingest(batch)
    assert job.ingest(batch) == []
    assert job.stats() == {"indexed": 2, "batches": 2}
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "mcq",
        title: "Orientation: what does this job actually do?",
        prompt: "Before touching anything, the interviewer asks you to summarise the job. **Select every statement that is true** of the code as written.",
        options: [
          "The dedup job never decodes pixels: hashes are computed at import (`importer.py`) and read from the catalog as integers.",
          "`near_pairs` only yields pairs whose real Hamming distance is within the threshold; the band tables only decide *which* pairs get a Hamming check.",
          "`phash.from_signed` corrupts hashes: masking a negative number with `0xFFFF...` throws the sign away, so two different hashes can collide.",
          "`merge_group` returns a *new* `Photo` for `merged` (via `dataclasses.replace`); the keeper object loaded from the catalog is not mutated.",
          "Photos under `MIN_DIMENSION` are folded into the group of their full-size original so their keywords are not lost.",
          "The path-compression loop in `DisjointSet.find` is broken: in `self.parent[x], x = root, self.parent[x]` the name `x` is rebound before `self.parent[x]` is written.",
        ],
        correct: [0, 1, 3],
        hints: [
          "Follow `catalog._hash` and `pipeline.find_duplicates`. Which module ever calls `imaging.resize`?",
          "For the tuple assignment: Python evaluates the whole right-hand side first, then assigns targets left to right.",
        ],
        explanation: `**True:** (0) only \`importer.hash_image\` touches pixels; the job works on stored 64-bit ints. (1) The band index is a *candidate filter*: every candidate is verified with \`hamming(...) <= threshold\` before it is yielded. (3) \`dataclasses.replace\` builds a new instance; the keeper is untouched.

**False:** (2) is a red herring. SQLite stores INTEGER as signed 64-bit, so \`-1\` *is* the bit pattern \`0xFFFF_FFFF_FFFF_FFFF\`; \`v & MASK64\` is exactly the two's-complement reinterpretation, a bijection on 64-bit patterns, so nothing collides. (4) Small images go to \`skipped\` and are never grouped. (5) Another red herring: the RHS tuple \`(root, self.parent[x])\` is evaluated first using the *old* \`x\`, then \`self.parent[x] = root\` is assigned (still the old \`x\`), and only then \`x\` is rebound to the old parent. The compression is correct; the bug you will find later is somewhere else in that class.`,
        timeLimitSec: 300,
        focusFile: "README.md",
      },
      {
        id: "s2",
        kind: "trace",
        title: "Trace `python3 main.py`",
        prompt: "Order these events as they **first** happen when `main.py` runs. Careful: one of the functions involved is a generator.",
        items: [
          "`load_catalog` builds `Photo` objects, converting hex hashes with `from_hex`",
          "`find_duplicates` splits photos into eligible / skipped by `MIN_DIMENSION`",
          "`clusters()` constructs `DisjointSet(n)`",
          "The `near_pairs` body starts running and creates the `BandIndex`",
          "`BandIndex.candidates` + `hamming` produce the first verified pair",
          "`DisjointSet.union` merges that pair",
          "`merge_group` → `choose_keeper` → `capture_instant` for the first group",
          "`report.render` formats the plan",
        ],
        hints: [
          "`pairs = near_pairs(eligible, threshold)` does not execute any of `near_pairs` yet.",
          "The generator body only starts when `clusters` begins its `for i, j, _ in pairs` loop, which is after `DisjointSet(n)` is built.",
        ],
        explanation: "`near_pairs` contains `yield`, so calling it only creates a generator object. Its body (including `BandIndex(bands)`) runs lazily when `clusters` starts iterating, i.e. **after** `DisjointSet(n)` is constructed. From then on candidate lookup and `union` interleave: each yielded pair is unioned before the next photo is even looked up. That interleaving matters for the next stage, because `union` sees the disjoint-set in a half-built state. Merging happens only after all pairs are consumed, and `render` is last.",
        timeLimitSec: 360,
        focusFile: "photolib/pipeline.py",
      },
      {
        id: "s3",
        kind: "predict",
        title: "Reproduce the radar by hand",
        prompt: `Predict **exactly** what \`python3 main.py\` prints for the bundled \`data/catalog.json\`.

Useful facts: \`BANDS = 4\`, so each band is 16 bits = 4 hex digits, band 0 being the *rightmost* four. Each hex digit differs from its neighbour by 1 bit when they differ only in the lowest bit (\`4\`→\`5\`, \`2\`→\`3\`...). \`0x33 ^ 0xcc = 0xff\` (8 bits), \`0x33 ^ 0x3c = 0x0f\` (4 bits).`,
        entry: "main.py",
        answer: `eligible=7 skipped=1 groups=2
group keeper=IMG_2001 members=IMG_2001,IMG_2002,IMG_2005 rating=5 fav=True
group keeper=IMG_2004 members=IMG_2003,IMG_2004 rating=4 fav=False
untouched=IMG_2007,IMG_2008`,
        options: [
          `eligible=7 skipped=1 groups=2
group keeper=IMG_2001 members=IMG_2001,IMG_2002,IMG_2005 rating=5 fav=True
group keeper=IMG_2004 members=IMG_2003,IMG_2004 rating=4 fav=False
untouched=IMG_2007,IMG_2008`,
          `eligible=7 skipped=1 groups=1
group keeper=IMG_2004 members=IMG_2001,IMG_2002,IMG_2003,IMG_2004,IMG_2005,IMG_2008 rating=5 fav=True
untouched=IMG_2007`,
          `eligible=7 skipped=1 groups=1
group keeper=IMG_2004 members=IMG_2001,IMG_2002,IMG_2003,IMG_2004,IMG_2005 rating=5 fav=True
untouched=IMG_2007,IMG_2008`,
          `eligible=7 skipped=1 groups=2
group keeper=IMG_2001 members=IMG_2001,IMG_2002,IMG_2005,IMG_2008 rating=5 fav=True
group keeper=IMG_2004 members=IMG_2003,IMG_2004 rating=4 fav=False
untouched=IMG_2007`,
          `eligible=8 skipped=0 groups=2
group keeper=IMG_2001 members=IMG_2001,IMG_2002,IMG_2005,IMG_2006 rating=5 fav=True
group keeper=IMG_2004 members=IMG_2003,IMG_2004 rating=4 fav=False
untouched=IMG_2007,IMG_2008`,
        ],
        hints: [
          "Work out the Hamming distances first: IMG_2001/2002 = 1, IMG_2003/2004 = 1, IMG_2005 is 4-5 bits from all four of them, IMG_2001 vs IMG_2003 = 8. IMG_2008 is 4 from IMG_2001 and 6 from IMG_2005.",
          "Does IMG_2008 share any 4-hex-digit band with anyone? If not, it is never even a candidate.",
          "For IMG_2005 (index 4) the candidates arrive in the order 2001, 2003, 2002, 2004. By then {2001,2002} and {2003,2004} are separate trees of size 2. Step through `union(0,4)` then `union(2,4)` with the code exactly as written: what does `self.parent[b] = ra` do when `ra` and `rb` were swapped?",
        ],
        explanation: `Two independent defects show up in one output.

**1. The bridge photo does not bridge.** Pairs arrive as (0,1), (2,3), then for IMG_2005 (index 4): (0,4), (2,4), (1,4), (3,4). After \`union(0,4)\` the tree rooted at 0 has size 3. \`union(2,4)\`: \`ra=2\` (size 2), \`rb=find(4)=0\` (size 3) → swapped to \`ra=0, rb=2\`. The code then writes \`self.parent[b] = ra\`, i.e. \`parent[4] = 0\`, which it already was. Root 2 is never attached, yet \`size[0]\` grows. The correct line is \`self.parent[rb] = ra\`: you link **roots**, never the original arguments. So we get {2001, 2002, 2005} and {2003, 2004} instead of one group.

**2. IMG_2008 is invisible.** Its hash \`1110 2223 3332 4454\` differs from IMG_2001 by one bit in *every* 16-bit band, so it shares no band with anyone and is never a candidate, despite being only 4 bits away. Pigeonhole: \`d\` differing bits can spoil at most \`d\` bands, so recall is guaranteed only when \`BANDS > HAMMING_THRESHOLD\`. With 4 bands and threshold 6 the index silently drops pairs.

Keepers: in the first group IMG_2001 has the most pixels; in the second both are 4032×3024 and IMG_2004 is \`edited\`. The 48×48 sticker is skipped, so \`eligible=7\`.`,
        timeLimitSec: 600,
        focusFile: "data/catalog.json",
      },
      {
        id: "s4",
        kind: "code",
        task: "fix",
        title: "Fix grouping and recall",
        prompt: `Fix both defects you just reproduced:

1. Clustering must be truly transitive: any chain of verified pairs ends up in one group, no matter the order pairs arrive in.
2. \`near_pairs(photos, 6)\` must find **every** pair within 6 bits, however the differing bits are spread across the hash.

Keep the banded index (no O(n²) scan). The bundled catalog must then produce a single group of six with keeper IMG_2004.`,
        editable: ["photolib/cluster.py", "photolib/index.py", "photolib/config.py"],
        tests: [
          {
            path: "tests/test_hidden_fix.py",
            content: `import json
import os
import random

from photolib.catalog import load_catalog
from photolib.cluster import DisjointSet, clusters
from photolib.index import near_pairs
from photolib.models import Photo
from photolib.pipeline import find_duplicates


def P(id, phash, **kw):
    base = dict(width=4032, height=3024, size_bytes=1000)
    base.update(kw)
    return Photo(id=id, phash=phash, **base)


def components(n, edges):
    adj = {i: set() for i in range(n)}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    seen, out = set(), []
    for s in range(n):
        if s in seen:
            continue
        stack, comp = [s], []
        seen.add(s)
        while stack:
            x = stack.pop()
            comp.append(x)
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    stack.append(y)
        if len(comp) > 1:
            out.append(sorted(comp))
    return sorted(out, key=lambda g: g[0])


def test_bridge_joins_two_existing_groups():
    # {0,1} and {2,3,4} exist; edge (1,3) must join them into one group.
    edges = [(0, 1, 0), (2, 3, 0), (2, 4, 0), (1, 3, 0)]
    assert clusters(5, edges) == [[0, 1, 2, 3, 4]]


def test_union_find_matches_bfs_on_random_graphs():
    rng = random.Random(7)
    for _ in range(200):
        n = rng.randint(2, 30)
        edges = []
        for _ in range(rng.randint(1, 40)):
            i, j = sorted(rng.sample(range(n), 2))
            edges.append((i, j))
        got = clusters(n, [(i, j, 0) for i, j in edges])
        assert got == components(n, edges), (n, edges)


def test_index_recall_up_to_threshold():
    rng = random.Random(11)
    for trial in range(300):
        base = rng.getrandbits(64)
        k = rng.randint(1, 6)
        flipped = base
        for bit in rng.sample(range(64), k):
            flipped ^= 1 << bit
        photos = [P("a", base), P("b", flipped)]
        pairs = list(near_pairs(photos, 6))
        assert [(i, j) for i, j, _ in pairs] == [(0, 1)], (hex(base), hex(flipped))


def test_bundled_catalog_is_one_group():
    here = os.path.dirname(os.path.abspath(__file__))
    photos = load_catalog(os.path.join(here, "..", "data", "catalog.json"))
    res = find_duplicates(photos)
    assert len(res.groups) == 1
    g = res.groups[0]
    assert g.keeper.id == "IMG_2004"
    assert sorted(p.id for p in g.members) == [
        "IMG_2001", "IMG_2002", "IMG_2003", "IMG_2004", "IMG_2005", "IMG_2008"]
    assert [p.id for p in res.untouched] == ["IMG_2007"]
`,
            hidden: true,
          },
        ],
        solution: {
          "photolib/cluster.py": `"""Transitive grouping of near-duplicate pairs."""
from collections import defaultdict


class DisjointSet:
    """Union-find with union by size and path compression."""

    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        # Path compression: point every node on the walk straight at root.
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        return True


def clusters(n, pairs):
    """Return groups (lists of indices, ascending) with at least two members,
    ordered by their smallest index."""
    ds = DisjointSet(n)
    for i, j, _ in pairs:
        ds.union(i, j)
    groups = defaultdict(list)
    for i in range(n):
        groups[ds.find(i)].append(i)
    return sorted((g for g in groups.values() if len(g) > 1), key=lambda g: g[0])
`,
          "photolib/config.py": `"""Tunables for the duplicate detector.

These mirror the values shipped with the 9.2 import settings. Changing
HASH_BITS requires re-hashing the entire library.
"""

HASH_BITS = 64

# Two hashes within this many differing bits are treated as the same picture.
HAMMING_THRESHOLD = 6

# The candidate index splits every hash into BANDS equal slices and only
# compares photos that agree exactly on at least one slice.
# Pigeonhole: d differing bits can spoil at most d slices, so recall is only
# guaranteed when BANDS > HAMMING_THRESHOLD. 8 slices of 8 bits each.
BANDS = 8

# Thumbnails / stickers / icons smaller than this (shortest side) are ignored.
MIN_DIMENSION = 64

# Used when a photo has a capture time but no OffsetTimeOriginal tag.
DEFAULT_TZ_OFFSET = "+00:00"
`,
        },
        hints: [
          "In `union`, which two nodes must be linked so that *both whole trees* become one?",
          "How many bands can `d` flipped bits touch? What must hold between `BANDS` and `HAMMING_THRESHOLD` for at least one band to survive untouched?",
          "`BANDS` must divide 64. The smallest value greater than 6 that does is 8 (8-bit slices).",
        ],
        explanation: `**Union-find:** \`self.parent[rb] = ra\`. Union-by-size swaps the roots so the smaller *root* goes under the larger one; writing to \`parent[b]\` (an arbitrary member) either re-parents a node that was already in \`ra\`'s tree (no merge at all) or detaches \`b\` from its subtree. A randomised comparison against BFS components is the quickest way to convince yourself.

**Recall:** multi-index hashing works by pigeonhole. Splitting 64 bits into \`m\` slices, two hashes at distance \`d\` have at least \`m - d\` identical slices, so a match is guaranteed iff \`m > d\`. With threshold 6 you need \`m ≥ 7\`; \`m\` must divide 64, so 8 slices of 8 bits. The cost: each slice has only 256 values, so buckets are ~\`n/256\` long instead of \`n/65536\` and you verify more candidates. That trade-off (recall vs candidate volume) is exactly what the last stage asks about.

Alternative accepted fixes: keep 4 bands and probe every slice variant within radius ⌊6/4⌋ = 1 bit (multi-probe), which also restores the guarantee.`,
        timeLimitSec: 900,
        focusFile: "photolib/cluster.py",
      },
      {
        id: "s5",
        kind: "find-bug",
        title: "Code review: the incremental job",
        prompt: `No AI in this round, so the interviewer plays reviewer. A teammate's \`jobs.IncrementalDeduper\` already ships on the background queue. Its docstring promises to report new photos that duplicate the library *or something earlier in the same batch*.

Click the line(s) responsible for a broken promise, then choose the root cause. (Assume the stage-4 fixes are in place.)`,
        file: "photolib/jobs.py",
        lines: [43, 44, 45],
        options: [
          "New photos are only indexed after the whole batch has been scanned, so two duplicates arriving in the same batch (e.g. the same burst AirDropped twice) are never compared with each other",
          "`candidates()` returns a dict keyed by id, so a library photo matching on several bands is verified only once and some pairs are lost",
          "The redelivery check `if p.id in self.known: continue` drops genuinely new photos, because `seed()` and `_remember` share the same dict",
          "`hamming` must be computed against every photo in `self.known`, not just candidates, otherwise results depend on BANDS",
        ],
        correct: 0,
        hints: [
          "Run the method in your head with a batch of two identical new photos and an empty library.",
          "When does the first new photo become visible to `self.index`?",
        ],
        explanation: `The scan loop (lines 36-42) queries the index, but new photos are only added in the *second* loop (lines 43-45). Inside one batch, photo B is looked up while photo A is not yet indexed, so A/B are never paired. The fix is to \`_remember(p)\` right after scanning \`p\`, inside the first loop. That is exactly what \`index.near_pairs\` does (query, then \`add\`), which is why the full job does not have this bug.

The other options are red herrings: the dict in \`candidates\` deduplicates *keys*, which is desired (one verification per pair). The redelivery check is correct idempotency: \`seed\` only puts library photos in \`known\`, and a genuinely new id is not there yet. With the stage-4 fix (\`BANDS = 8\`) candidates have full recall, so a full scan is unnecessary.`,
        timeLimitSec: 420,
        focusFile: "photolib/jobs.py",
      },
      {
        id: "s6",
        kind: "code",
        task: "feature",
        title: "Feature: tripod shots and album membership",
        prompt: `Ship the two "Known gaps" from the README.

1. **Tripod-shot guard (PHOTOS-4471).** Add \`MAX_CAPTURE_GAP_SEC = 2\` to \`photolib/config.py\`. A verified pair is only linked if both capture *instants* are within that many seconds (inclusive). Compare real instants: \`12:00:00+02:00\` and \`10:00:01+00:00\` are 1 s apart, while \`12:00:00+02:00\` and \`12:00:00-01:00\` are 3 hours apart. If either photo is undated, the rule does not block the pair.
2. **Albums.** \`merged.albums\` is the exact-string union of all members' albums: the keeper's albums first in their order, then new albums in member order. Do not mutate any input \`Photo\`.`,
        editable: [
          "photolib/config.py",
          "photolib/pipeline.py",
          "photolib/merge.py",
          "photolib/exif.py",
          "photolib/cluster.py",
          "photolib/index.py",
        ],
        tests: [
          {
            path: "tests/test_hidden_feature.py",
            content: `from photolib import config
from photolib.models import Photo
from photolib.pipeline import find_duplicates


def P(id, phash=0x5A5A5A5A5A5A5A5A, **kw):
    base = dict(width=4032, height=3024, size_bytes=1000)
    base.update(kw)
    return Photo(id=id, phash=phash, **base)


def ids(group):
    return sorted(p.id for p in group.members)


def test_config_exposes_gap():
    assert config.MAX_CAPTURE_GAP_SEC == 2


def test_tripod_shots_hours_apart_are_not_merged():
    a = P("a", taken_at="2024:03:01 06:00:00", tz_offset="+01:00")
    b = P("b", taken_at="2024:03:01 06:00:01", tz_offset="+01:00")
    c = P("c", taken_at="2024:03:01 09:00:00", tz_offset="+01:00")
    res = find_duplicates([a, b, c])
    assert len(res.groups) == 1
    assert ids(res.groups[0]) == ["a", "b"]
    assert [p.id for p in res.untouched] == ["c"]


def test_gap_uses_utc_instants_not_wall_clock():
    # Same moment written in two zones: 12:00:00+02:00 == 10:00:01Z minus 1s
    a = P("a", taken_at="2024:05:01 12:00:00", tz_offset="+02:00")
    b = P("b", taken_at="2024:05:01 10:00:01", tz_offset="+00:00")
    res = find_duplicates([a, b])
    assert len(res.groups) == 1
    # Same wall clock, different zones: 3 hours apart in reality
    c = P("c", taken_at="2024:05:01 12:00:00", tz_offset="+02:00")
    d = P("d", taken_at="2024:05:01 12:00:00", tz_offset="-01:00")
    res = find_duplicates([c, d])
    assert res.groups == []


def test_boundary_is_inclusive():
    a = P("a", taken_at="2024:05:01 12:00:00", tz_offset="+00:00")
    b = P("b", taken_at="2024:05:01 12:00:02", tz_offset="+00:00")
    c = P("c", phash=0x0F0F0F0F0F0F0F0F, taken_at="2024:05:01 12:00:00", tz_offset="+00:00")
    d = P("d", phash=0x0F0F0F0F0F0F0F0F, taken_at="2024:05:01 12:00:03", tz_offset="+00:00")
    res = find_duplicates([a, b, c, d])
    assert [ids(g) for g in res.groups] == [["a", "b"]]


def test_undated_photos_still_merge():
    a = P("a", taken_at="2024:05:01 12:00:00", tz_offset="+00:00")
    b = P("b")  # screenshot re-import, EXIF stripped
    res = find_duplicates([a, b])
    assert len(res.groups) == 1


def test_albums_are_unioned_keeper_first():
    a = P("a", size_bytes=10, albums=["Trips", "Shared: Mum"])
    b = P("b", size_bytes=99, albums=["Favourites 2024", "Trips"])
    c = P("c", size_bytes=50, albums=["Print"])
    res = find_duplicates([a, b, c])
    g = res.groups[0]
    assert g.keeper.id == "b"
    assert g.merged.albums == ["Favourites 2024", "Trips", "Shared: Mum", "Print"]
    # the keeper object itself is not mutated
    assert b.albums == ["Favourites 2024", "Trips"]
`,
            hidden: true,
          },
        ],
        solution: {
          "photolib/config.py": `"""Tunables for the duplicate detector.

These mirror the values shipped with the 9.2 import settings. Changing
HASH_BITS requires re-hashing the entire library.
"""

HASH_BITS = 64

# Two hashes within this many differing bits are treated as the same picture.
HAMMING_THRESHOLD = 6

# The candidate index splits every hash into BANDS equal slices and only
# compares photos that agree exactly on at least one slice.
# Pigeonhole: d differing bits can spoil at most d slices, so recall is only
# guaranteed when BANDS > HAMMING_THRESHOLD. 8 slices of 8 bits each.
BANDS = 8

# Thumbnails / stickers / icons smaller than this (shortest side) are ignored.
MIN_DIMENSION = 64

# Two near-identical hashes are only the same photo if they were captured
# within this many seconds of each other (tripod shots, PHOTOS-4471).
# Undated photos are never blocked by this rule.
MAX_CAPTURE_GAP_SEC = 2

# Used when a photo has a capture time but no OffsetTimeOriginal tag.
DEFAULT_TZ_OFFSET = "+00:00"
`,
          "photolib/pipeline.py": `"""The dedup job: filter -> candidate pairs -> clusters -> merge."""
from .cluster import clusters
from .config import HAMMING_THRESHOLD, MAX_CAPTURE_GAP_SEC, MIN_DIMENSION
from .exif import seconds_between
from .index import near_pairs
from .merge import merge_group
from .models import DedupResult, DuplicateGroup


def is_eligible(p):
    return min(p.width, p.height) >= MIN_DIMENSION


def close_in_time(a, b):
    gap = seconds_between(a, b)
    return gap is None or gap <= MAX_CAPTURE_GAP_SEC


def find_duplicates(photos, threshold=HAMMING_THRESHOLD):
    eligible = [p for p in photos if is_eligible(p)]
    skipped = [p for p in photos if not is_eligible(p)]

    pairs = (
        (i, j, d)
        for i, j, d in near_pairs(eligible, threshold)
        if close_in_time(eligible[i], eligible[j])
    )
    groups = []
    grouped = set()
    for idxs in clusters(len(eligible), pairs):
        members = [eligible[i] for i in idxs]
        keeper, dups, merged = merge_group(members)
        groups.append(DuplicateGroup(keeper=keeper, duplicates=dups, merged=merged))
        grouped.update(idxs)

    untouched = [p for i, p in enumerate(eligible) if i not in grouped]
    return DedupResult(groups=groups, untouched=untouched, skipped=skipped)
`,
          "photolib/merge.py": `"""Keeper selection and metadata merge for one duplicate group."""
from dataclasses import replace

from .exif import capture_instant


def choose_keeper(photos):
    """Most pixels wins; then an edited version; then the larger file; then
    the earliest capture; finally the lowest id (determinism)."""
    def key(p):
        inst = capture_instant(p)
        ts = inst.timestamp() if inst else float("inf")
        return (-p.pixels, not p.edited, -p.size_bytes, ts, p.id)
    return min(photos, key=key)


def _merge_keywords(keeper, others):
    """Case-insensitive union. The keeper's spelling and order come first,
    then new keywords in the order the other photos are listed."""
    out = []
    seen = set()
    for p in [keeper] + others:
        for kw in p.keywords:
            k = kw.casefold()
            if k not in seen:
                seen.add(k)
                out.append(kw)
    return out


def _merge_albums(keeper, others):
    """Exact-name union: keeper's albums first, then new ones in order."""
    out = list(keeper.albums)
    for p in others:
        for a in p.albums:
            if a not in out:
                out.append(a)
    return out


def _earliest(photos):
    dated = [(capture_instant(p), p) for p in photos]
    dated = [(i, p) for i, p in dated if i is not None]
    if not dated:
        return None
    return min(dated, key=lambda t: t[0])[1]


def merge_group(photos):
    """Return (keeper, duplicates, merged) where \`merged\` is a copy of the
    keeper carrying the union of everyone's metadata."""
    keeper = choose_keeper(photos)
    others = [p for p in photos if p is not keeper]
    first = _earliest(photos)
    gps = keeper.gps
    if gps is None:
        gps = next((p.gps for p in others if p.gps is not None), None)
    merged = replace(
        keeper,
        keywords=_merge_keywords(keeper, others),
        albums=_merge_albums(keeper, others),
        rating=max(p.rating for p in photos),
        favorite=any(p.favorite for p in photos),
        gps=gps,
        taken_at=first.taken_at if first else keeper.taken_at,
        tz_offset=first.tz_offset if first else keeper.tz_offset,
    )
    return keeper, others, merged
`,
          "photolib/cluster.py": `"""Transitive grouping of near-duplicate pairs."""
from collections import defaultdict


class DisjointSet:
    """Union-find with union by size and path compression."""

    def __init__(self, n):
        self.parent = list(range(n))
        self.size = [1] * n

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        # Path compression: point every node on the walk straight at root.
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        return True


def clusters(n, pairs):
    """Return groups (lists of indices, ascending) with at least two members,
    ordered by their smallest index."""
    ds = DisjointSet(n)
    for i, j, _ in pairs:
        ds.union(i, j)
    groups = defaultdict(list)
    for i in range(n):
        groups[ds.find(i)].append(i)
    return sorted((g for g in groups.values() if len(g) > 1), key=lambda g: g[0])
`,
        },
        hints: [
          "`exif.seconds_between` already returns the UTC gap, or `None` when either photo is undated.",
          "Filter pairs *before* they reach `clusters`; `near_pairs` yields indices into `eligible`.",
          "For albums, copy the keeper's list (`list(keeper.albums)`) before appending: `replace()` would otherwise share and mutate the keeper's list.",
        ],
        explanation: `The right place for the guard is between candidate verification and clustering: filter \`(i, j, d)\` with \`close_in_time(eligible[i], eligible[j])\`. Putting it in \`merge_group\` is too late, because the group has already been formed transitively.

Using \`capture_instant\` (UTC) instead of the raw \`taken_at\` strings is the whole point: EXIF time is local wall-clock time, and edited copies are often re-exported with a different offset.

Note the limitation the interviewer will probe next: the rule is *per pair*, so clustering is still transitive. Two shots three hours apart can be chained through an undated copy that matches both. A production fix would check the time spread of the final group (or use complete linkage).

For albums, building a fresh list is essential: \`dataclasses.replace\` copies field *references*, so \`merged.albums.append(...)\` on a shared list would silently edit the keeper.`,
        timeLimitSec: 840,
        focusFile: "photolib/pipeline.py",
      },
      {
        id: "s7",
        kind: "mcq",
        title: "Follow-up: 2 million photos, looser threshold",
        prompt: "Product wants to catch heavily re-encoded copies, so the threshold goes from 6 to **10**, and the job must handle iCloud libraries of **2 million** photos. Select **all** statements that are true.",
        options: [
          "With 64-bit hashes, guaranteed recall at threshold 10 needs at least 11 slices, e.g. 16 slices of 4 bits; each slice then has only 16 values, so every bucket holds ~1/16 of the library and the candidate count approaches the O(n²) scan.",
          "A looser threshold increases chaining risk in transitive clustering: A~B~C~D can merge pictures that look nothing alike end to end; checking the group diameter (or complete linkage) mitigates it.",
          "The capture-gap rule from stage 6 is per pair, so an undated photo matching two dated photos taken hours apart can still pull them into one group.",
          "At 2M photos the disjoint-set becomes the bottleneck; replacing it with BFS over an adjacency list would be asymptotically faster.",
          "Raising the threshold cannot hurt precision because dHash values of different images never collide.",
        ],
        correct: [0, 1, 2],
        hints: [
          "Revisit the pigeonhole argument from stage 4 with d = 10.",
          "Union-find with path compression and union by size is near-linear (inverse Ackermann).",
        ],
        explanation: `(0) Pigeonhole again: slices must outnumber allowed bit errors. Thin slices kill selectivity, so at large thresholds teams switch to multi-probe indexing, BK-trees / vantage-point trees, or a longer hash with more bands. (1) Single-linkage chaining is the classic failure mode of transitive near-duplicate grouping. (2) Per-pair rules do not survive transitivity, which is the same lesson again.

(3) False: union-find costs O(α(n)) per operation, which is effectively constant; BFS is also linear, so there is no asymptotic win, and the time goes into candidate verification. (4) False: 64-bit perceptual hashes of different images collide often at loose thresholds (similar compositions, flat skies), which is why precision falls as the threshold grows.`,
        timeLimitSec: 300,
      },
    ],
  },
  {
    id: "l5-sim-blackrock-var-engine",
    title: "Historical VaR Engine: Overnight Risk Pack",
    level: 5,
    rating: 2700,
    lang: "python",
    domain: "risk",
    companies: ["blackrock"],
    tags: [
      "interview-simulation",
      "var",
      "expected-shortfall",
      "floating-point",
      "time-series-alignment",
      "optimisation",
    ],
    summary: "Positions → exposures → historical-sim VaR. The tail index is off, an AI \"speed-up\" misaligns holidays, and P&L is O(S·P·F).",
    context: `**BlackRock-style AI-enabled round:** 7 stages on one codebase, ~60 minutes. You may use the assistant panel, but you own every line you accept.

You are on Risk Technology. \`riskengine\` produces the overnight historical-simulation VaR for the multi-asset desks. Model Validation (ticket MV-2291) says the numbers do not match their independent re-implementation of the README's tail convention, and the job overran its batch window twice last week after a new fund was onboarded.

The README's **Conventions** section is the spec. Read it first.`,
    persona: "confident-intern",
    files: [
      {
        path: "README.md",
        content: `# riskengine

Overnight historical-simulation VaR for the multi-asset desks. Owned by
Risk Technology; consumed by the 07:00 risk pack and the limits monitor.

## Model

1. **Positions -> exposures** (\`exposures.py\`). Each position is mapped to
   one or more *risk factors* with a base-currency (USD) sensitivity:
   \`pnl = base_amount * factor_return\`.
   * equity: notional on its own price factor, plus FX exposure if non-USD
   * future: \`qty * multiplier * underlying\` on the underlying; no FX
     exposure on notional (daily margining, see comment in code)
   * option: delta-adjusted notional on the underlying
2. **Scenarios** (\`scenarios.py\`). One scenario per business day in the
   lookback window: the vector of one-day factor returns observed that day.
   Prices are aligned to the *global* calendar and forward-filled across
   local holidays (a stale price is a zero return, never a shifted one).
3. **P&L vector** (\`pnl.py\`). Linear P&L per scenario.
4. **VaR / ES** (\`var.py\`). See conventions below.
5. **Aggregation** (\`aggregation.py\`). Standalone VaR per book plus the
   diversification benefit.

## Conventions (agreed with Model Validation, MV-2291)

* Losses are reported as **positive** numbers.
* With \`n\` scenarios and confidence \`c\`, the tail holds
  \`k = ceil(n * (1 - c))\` scenarios.
* **VaR** is the loss of the k-th worst scenario (1-indexed).
* **ES** is the average loss of the k worst scenarios.
* \`n = 250, c = 0.99 -> k = 3\`: VaR is the 3rd worst day.
* Multi-day VaR uses square-root-of-time scaling of the 1-day number.

## Running

\`\`\`
python3 main.py                  # sample portfolio, config/risk.toml
python3 scripts/var_check.py     # sanity check of the tail convention
\`\`\`
`,
        language: "markdown",
      },
      {
        path: "config/risk.toml",
        content: `# Sample configuration. Production overrides live in the risk-config repo.
base_currency = "USD"
confidence = 0.95
lookback_days = 20
horizon_days = 1
fx_factors = true
`,
        language: "text",
      },
      {
        path: "main.py",
        content: `import os

from riskengine.config import load_config
from riskengine.engine import run
from riskengine.fx import FxTable
from riskengine.loaders import load_instruments, load_positions
from riskengine.marketdata import PriceStore
from riskengine.report import render

HERE = os.path.dirname(os.path.abspath(__file__))
ASOF = "2026-07-24"


def path(*p):
    return os.path.join(HERE, *p)


if __name__ == "__main__":
    cfg = load_config(path("config", "risk.toml"))
    store = PriceStore.from_csv(path("data", "prices.csv"))
    fx = FxTable().load_quotes({"EURUSD": store.price_on("FX:EUR", ASOF)})
    result = run(
        load_positions(path("data", "positions.csv")),
        load_instruments(path("data", "instruments.csv")),
        store, fx, ASOF, cfg,
    )
    print(render(result, cfg))
`,
      },
      {
        path: "riskengine/__init__.py",
        content: `"""Historical-simulation VaR engine."""

__version__ = "3.4.1"
`,
      },
      {
        path: "riskengine/config.py",
        content: `from dataclasses import dataclass, fields


@dataclass(frozen=True)
class RiskConfig:
    base_currency: str = "USD"
    confidence: float = 0.99
    lookback_days: int = 250
    horizon_days: int = 1
    fx_factors: bool = True


def _parse_value(raw):
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    if raw in ("true", "false"):
        return raw == "true"
    if "." in raw:
        return float(raw)
    return int(raw)


def load_config(path):
    """Minimal \`key = value\` TOML reader (no tables) - the job runs on a
    locked-down host without third-party packages."""
    known = {f.name for f in fields(RiskConfig)}
    values = {}
    with open(path) as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            key, _, raw = line.partition("=")
            key = key.strip()
            if key not in known:
                raise ValueError("unknown config key: %s" % key)
            values[key] = _parse_value(raw)
    cfg = RiskConfig(**values)
    if cfg.base_currency != "USD":
        raise ValueError("only USD base is supported")
    if not 0.5 < cfg.confidence < 1.0:
        raise ValueError("confidence must be in (0.5, 1)")
    return cfg
`,
      },
      {
        path: "riskengine/models.py",
        content: `from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass(frozen=True)
class Instrument:
    id: str
    kind: str                      # "equity" | "future" | "option"
    currency: str
    underlying: Optional[str] = None   # price factor for derivatives
    multiplier: float = 1.0
    delta: float = 1.0                 # options: from the pricing service, per unit underlying


@dataclass(frozen=True)
class Position:
    book: str
    instrument_id: str
    quantity: float


@dataclass(frozen=True)
class Exposure:
    book: str
    position_key: str
    factor: str
    # Base-currency P&L for a +100% move in the factor; linear model.
    base_amount: float


@dataclass
class Scenario:
    date: str
    # (factor, one-day return), sorted by factor name
    shocks: List[Tuple[str, float]]
`,
      },
      {
        path: "riskengine/loaders.py",
        content: `"""CSV loaders for the overnight extract."""
import csv

from .models import Instrument, Position


def load_instruments(path):
    out = {}
    with open(path) as fh:
        for row in csv.DictReader(fh):
            out[row["id"]] = Instrument(
                id=row["id"],
                kind=row["kind"],
                currency=row["currency"],
                underlying=row["underlying"] or None,
                multiplier=float(row["multiplier"] or 1),
                delta=float(row["delta"] or 1),
            )
    return out


def load_positions(path):
    with open(path) as fh:
        return [Position(r["book"], r["instrument_id"], float(r["quantity"]))
                for r in csv.DictReader(fh)]
`,
      },
      {
        path: "riskengine/engine.py",
        content: `"""Orchestration for one as-of date."""
from dataclasses import dataclass
from typing import Dict, List

from .aggregation import diversification_benefit, standalone_var
from .exposures import portfolio_exposures
from .pnl import pnl_vector
from .scenarios import build_scenarios
from .var import expected_shortfall, historical_var, scale_horizon


@dataclass
class RiskResult:
    asof: str
    var: float
    es: float
    by_book: Dict[str, float]
    diversification: float
    worst_date: str
    pnls: List[float]


def run(positions, instruments, store, fx, asof, cfg):
    exposures = portfolio_exposures(positions, instruments, store, fx, asof, cfg.fx_factors)
    factors = sorted({e.factor for e in exposures})
    scenarios = build_scenarios(store, factors, asof, cfg.lookback_days)
    pnls = pnl_vector(exposures, scenarios)

    total = historical_var(pnls, cfg.confidence)
    by_book = standalone_var(exposures, scenarios, cfg.confidence)
    worst = min(range(len(pnls)), key=lambda i: pnls[i])
    return RiskResult(
        asof=asof,
        var=scale_horizon(total, cfg.horizon_days),
        es=scale_horizon(expected_shortfall(pnls, cfg.confidence), cfg.horizon_days),
        by_book={b: scale_horizon(v, cfg.horizon_days) for b, v in by_book.items()},
        diversification=scale_horizon(diversification_benefit(by_book, total), cfg.horizon_days),
        worst_date=scenarios[worst].date,
        pnls=pnls,
    )
`,
      },
      {
        path: "riskengine/exposures.py",
        content: `"""Positions -> linear factor exposures in USD."""
from .models import Exposure


def fx_factor(ccy):
    return "FX:" + ccy


def position_exposures(pos, inst, prices, fx, asof, fx_factors=True):
    key = "%s/%s" % (pos.book, pos.instrument_id)
    if inst.kind == "equity":
        factor = inst.id
        notional = pos.quantity * prices.price_on(factor, asof)
    elif inst.kind == "future":
        factor = inst.underlying
        notional = pos.quantity * inst.multiplier * prices.price_on(factor, asof)
    elif inst.kind == "option":
        # Delta-equivalent underlying notional. Gamma/vega are out of scope
        # for the linear engine (they live in the full-reval engine).
        factor = inst.underlying
        notional = pos.quantity * inst.multiplier * inst.delta * prices.price_on(factor, asof)
    else:
        raise ValueError("unsupported instrument kind %r" % inst.kind)

    base = fx.to_base(notional, inst.currency)
    out = [Exposure(pos.book, key, factor, base)]

    # A EUR stock held by a USD fund loses value if EUR falls, even if the
    # stock is flat: same USD amount on the FX factor. Futures are margined
    # daily, so only the (small) unrealised P&L is in foreign currency - no
    # FX exposure on the notional.
    if fx_factors and inst.currency != "USD" and inst.kind != "future":
        out.append(Exposure(pos.book, key, fx_factor(inst.currency), base))
    return out


def portfolio_exposures(positions, instruments, prices, fx, asof, fx_factors=True):
    out = []
    for pos in positions:
        inst = instruments[pos.instrument_id]
        out.extend(position_exposures(pos, inst, prices, fx, asof, fx_factors))
    return out
`,
      },
      {
        path: "riskengine/fx.py",
        content: `"""Spot FX to the USD base."""


class FxTable:
    """Holds rates as USD per 1 unit of currency.

    Market convention quotes some pairs the other way round: EURUSD = 1.08
    is USD per EUR, but USDJPY = 151.2 is JPY per USD. \`load_quotes\`
    normalises both to USD-per-unit.
    """

    def __init__(self):
        self.rates = {"USD": 1.0}

    def load_quotes(self, quotes):
        for pair, px in quotes.items():
            base, quote = pair[:3], pair[3:]
            if quote == "USD":
                self.rates[base] = px
            elif base == "USD":
                self.rates[quote] = 1.0 / px
            else:
                raise ValueError("cross pair %s not supported; quote vs USD" % pair)
        return self

    def to_base(self, amount, ccy):
        try:
            return amount * self.rates[ccy]
        except KeyError:
            raise KeyError("no FX rate for %s" % ccy) from None
`,
      },
      {
        path: "riskengine/marketdata.py",
        content: `"""Price history store with holiday-aware alignment."""
import csv
from bisect import bisect_right
from collections import defaultdict


class MissingPrice(KeyError):
    pass


class PriceStore:
    def __init__(self):
        self._px = defaultdict(dict)      # factor -> {date: price}
        self._sorted = {}                 # factor -> sorted dates (cache)

    def add(self, factor, date, price):
        if price <= 0:
            raise ValueError("non-positive price for %s on %s" % (factor, date))
        self._px[factor][date] = float(price)
        self._sorted.pop(factor, None)

    @classmethod
    def from_csv(cls, path):
        store = cls()
        with open(path) as fh:
            for row in csv.DictReader(fh):
                store.add(row["factor"], row["date"], float(row["price"]))
        return store

    def factors(self):
        return sorted(self._px)

    def calendar(self):
        """Global calendar: every date on which *any* factor printed."""
        return sorted({d for series in self._px.values() for d in series})

    def series(self, factor):
        """[(date, price)] in date order, only dates the factor traded."""
        return [(d, self._px[factor][d]) for d in self._dates(factor)]

    def _dates(self, factor):
        if factor not in self._sorted:
            if factor not in self._px:
                raise MissingPrice(factor)
            self._sorted[factor] = sorted(self._px[factor])
        return self._sorted[factor]

    def price_on(self, factor, date):
        """Price on \`date\`, forward-filled from the last print on or before it."""
        dates = self._dates(factor)
        i = bisect_right(dates, date) - 1
        if i < 0:
            raise MissingPrice("%s has no price on or before %s" % (factor, date))
        return self._px[factor][dates[i]]

    def aligned_returns(self, factor, dates):
        """Simple returns on the given calendar: r[i] = P(d[i+1]) / P(d[i]) - 1.
        Missing days are forward-filled, so a local holiday is a 0.0 return
        and the move is booked on the day the market actually reopened."""
        prices = [self.price_on(factor, d) for d in dates]
        return [b / a - 1.0 for a, b in zip(prices, prices[1:])]
`,
      },
      {
        path: "riskengine/calendar.py",
        content: `"""Business-date helpers. Dates are ISO strings ("2026-07-03"), which sort
lexicographically in chronological order."""
from datetime import date


def parse(d):
    return date.fromisoformat(d)


def is_weekend(d):
    return parse(d).weekday() >= 5


def window(calendar, asof, n_returns):
    """The last n_returns + 1 dates up to and including \`asof\`: n returns
    need n + 1 prices."""
    eligible = [d for d in calendar if d <= asof]
    if len(eligible) < n_returns + 1:
        raise InsufficientHistory(
            "need %d dates up to %s, have %d" % (n_returns + 1, asof, len(eligible)))
    return eligible[-(n_returns + 1):]


class InsufficientHistory(Exception):
    pass
`,
      },
      {
        path: "riskengine/scenarios.py",
        content: `"""Historical scenarios: one per business day in the lookback window."""
from .calendar import window
from .models import Scenario


def build_scenarios(store, factors, asof, lookback):
    """Scenario i holds every factor's one-day return from dates[i] to
    dates[i+1] on the global calendar. Returns \`lookback\` scenarios,
    oldest first."""
    dates = window(store.calendar(), asof, lookback)
    rets = {f: store.aligned_returns(f, dates) for f in factors}
    scenarios = []
    for i in range(lookback):
        shocks = sorted((f, rets[f][i]) for f in factors)
        scenarios.append(Scenario(date=dates[i + 1], shocks=shocks))
    return scenarios
`,
      },
      {
        path: "riskengine/pnl.py",
        content: `"""Linear scenario P&L."""


def _shock(scenario, factor):
    for name, r in scenario.shocks:
        if name == factor:
            return r
    raise KeyError("no shock for %s on %s" % (factor, scenario.date))


def pnl_vector(exposures, scenarios):
    """P&L of the whole exposure set under each scenario, in scenario order:
    pnl[s] = sum(e.base_amount * return of e.factor in scenario s).
    Raises KeyError if an exposure's factor is missing from a scenario."""
    out = []
    for sc in scenarios:
        total = 0.0
        for e in exposures:
            total += e.base_amount * _shock(sc, e.factor)
        out.append(total)
    return out


def pnl_by_book(exposures, scenarios):
    books = {}
    for e in exposures:
        books.setdefault(e.book, []).append(e)
    return {b: pnl_vector(es, scenarios) for b, es in sorted(books.items())}
`,
      },
      {
        path: "riskengine/var.py",
        content: `"""Historical VaR and Expected Shortfall. Conventions: see README (MV-2291)."""
import math


def tail_count(n, confidence):
    """Number of scenarios in the tail: k = ceil(n * (1 - confidence))."""
    if n <= 0:
        raise ValueError("no scenarios")
    return math.ceil(n * (1 - confidence))


def historical_var(pnls, confidence):
    """Loss (positive) of the k-th worst scenario."""
    ordered = sorted(pnls)
    k = tail_count(len(ordered), confidence)
    return -ordered[k]


def expected_shortfall(pnls, confidence):
    """Average loss (positive) of the k worst scenarios."""
    ordered = sorted(pnls)
    k = tail_count(len(ordered), confidence)
    return -sum(ordered[:k]) / k


def scale_horizon(one_day, days):
    """Square-root-of-time scaling. Assumes i.i.d. daily P&L."""
    return one_day * math.sqrt(days)
`,
      },
      {
        path: "riskengine/aggregation.py",
        content: `"""Book-level VaR and diversification."""
from .pnl import pnl_by_book
from .var import historical_var


def standalone_var(exposures, scenarios, confidence):
    return {b: historical_var(p, confidence)
            for b, p in pnl_by_book(exposures, scenarios).items()}


def diversification_benefit(standalone, total):
    """Sum of standalone VaRs minus portfolio VaR.

    Usually positive. Historical VaR is not sub-additive, so this CAN be
    negative for concentrated tail risk - do not clamp it, the limits team
    alerts on negative values."""
    return sum(standalone.values()) - total
`,
      },
      {
        path: "riskengine/report.py",
        content: `def money(x):
    return "{:,.0f}".format(x)


def render(result, cfg):
    lines = [
        "as of %s  %d-day VaR %.1f%%  lookback %d" % (
            result.asof, cfg.horizon_days, cfg.confidence * 100, cfg.lookback_days),
        "  portfolio VaR  %s" % money(result.var),
        "  portfolio ES   %s" % money(result.es),
    ]
    for book, v in result.by_book.items():
        lines.append("  %-12s %s" % (book, money(v)))
    lines.append("  diversification %s" % money(result.diversification))
    lines.append("  worst day %s" % result.worst_date)
    return "\\n".join(lines)
`,
      },
      {
        path: "scripts/var_check.py",
        content: `"""Sanity check of the tail convention on a hand-checkable P&L strip.
Run from the repo root: python3 scripts/var_check.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from riskengine.var import expected_shortfall, historical_var, tail_count  # noqa: E402

# 20 days of desk P&L in $k
PNLS = [-12.0, 3.5, -40.0, 8.0, -3.0, 15.0, -22.5, 1.0, -7.0, 4.0,
        -1.5, 9.0, -18.0, 2.0, 6.5, -9.0, 11.0, -0.5, 5.0, -30.0]

for c in (0.99, 0.95, 0.90):
    print("%.2f k=%d VaR=%.1f ES=%.1f" % (
        c, tail_count(len(PNLS), c), historical_var(PNLS, c), expected_shortfall(PNLS, c)))
`,
      },
      {
        path: "data/instruments.csv",
        content: `id,kind,currency,underlying,multiplier,delta
AAPL,equity,USD,,1,
SAP.DE,equity,EUR,,1,
ESU6,future,USD,ES,50,
NVDA_C150_DEC26,option,USD,NVDA,100,0.42
`,
        language: "text",
      },
      {
        path: "data/positions.csv",
        content: `book,instrument_id,quantity
EQ-LONG,AAPL,12000
EQ-LONG,SAP.DE,8000
EQ-LONG,NVDA_C150_DEC26,150
MACRO,ESU6,-20
MACRO,SAP.DE,-3000
`,
        language: "text",
      },
      {
        path: "data/prices.csv",
        content: `date,factor,price
2026-06-22,AAPL,211.5884
2026-06-22,SAP.DE,240.5076
2026-06-22,ES,6259.6008
2026-06-22,NVDA,150.3449
2026-06-22,FX:EUR,1.0743
2026-06-23,AAPL,211.5363
2026-06-23,SAP.DE,240.5945
2026-06-23,ES,6277.8850
2026-06-23,NVDA,152.0824
2026-06-23,FX:EUR,1.0803
2026-06-24,AAPL,213.2710
2026-06-24,SAP.DE,239.9321
2026-06-24,ES,6251.6593
2026-06-24,NVDA,154.7790
2026-06-24,FX:EUR,1.0881
2026-06-25,AAPL,213.0532
2026-06-25,SAP.DE,241.4450
2026-06-25,ES,6180.5252
2026-06-25,NVDA,153.7351
2026-06-25,FX:EUR,1.0904
2026-06-26,AAPL,214.2540
2026-06-26,SAP.DE,244.2348
2026-06-26,ES,6225.1865
2026-06-26,NVDA,159.0385
2026-06-26,FX:EUR,1.0884
2026-06-29,AAPL,211.0828
2026-06-29,SAP.DE,238.2340
2026-06-29,ES,6216.1873
2026-06-29,NVDA,157.1697
2026-06-29,FX:EUR,1.0941
2026-06-30,AAPL,209.0134
2026-06-30,SAP.DE,241.8242
2026-06-30,ES,6191.1234
2026-06-30,NVDA,158.7236
2026-06-30,FX:EUR,1.0950
2026-07-01,AAPL,211.5843
2026-07-01,SAP.DE,243.7857
2026-07-01,ES,6212.7032
2026-07-01,NVDA,161.5264
2026-07-01,FX:EUR,1.0974
2026-07-02,AAPL,208.1669
2026-07-02,SAP.DE,241.2186
2026-07-02,ES,6214.1489
2026-07-02,NVDA,158.7338
2026-07-02,FX:EUR,1.1056
2026-07-03,SAP.DE,236.5897
2026-07-03,FX:EUR,1.1063
2026-07-06,AAPL,212.6176
2026-07-06,SAP.DE,241.6302
2026-07-06,ES,6338.0706
2026-07-06,NVDA,162.4381
2026-07-06,FX:EUR,1.1047
2026-07-07,AAPL,214.2191
2026-07-07,SAP.DE,236.6433
2026-07-07,ES,6319.5368
2026-07-07,NVDA,161.8696
2026-07-07,FX:EUR,1.1016
2026-07-08,AAPL,217.4923
2026-07-08,SAP.DE,244.2344
2026-07-08,ES,6378.3181
2026-07-08,NVDA,161.6106
2026-07-08,FX:EUR,1.1015
2026-07-09,AAPL,218.4642
2026-07-09,SAP.DE,240.9778
2026-07-09,ES,6342.9084
2026-07-09,NVDA,162.0978
2026-07-09,FX:EUR,1.0955
2026-07-10,AAPL,212.3392
2026-07-10,SAP.DE,237.4618
2026-07-10,ES,6302.9238
2026-07-10,NVDA,162.8585
2026-07-10,FX:EUR,1.0998
2026-07-13,AAPL,213.0539
2026-07-13,SAP.DE,237.8717
2026-07-13,ES,6356.9217
2026-07-13,NVDA,166.2961
2026-07-13,FX:EUR,1.1010
2026-07-14,AAPL,213.4746
2026-07-14,SAP.DE,236.8669
2026-07-14,ES,6380.7593
2026-07-14,NVDA,163.1507
2026-07-14,FX:EUR,1.1062
2026-07-15,AAPL,217.3182
2026-07-15,SAP.DE,236.4583
2026-07-15,ES,6340.6664
2026-07-15,NVDA,157.6782
2026-07-15,FX:EUR,1.1044
2026-07-16,AAPL,222.8860
2026-07-16,SAP.DE,241.1097
2026-07-16,ES,6274.2983
2026-07-16,NVDA,164.4083
2026-07-16,FX:EUR,1.1115
2026-07-17,AAPL,219.7341
2026-07-17,SAP.DE,239.9897
2026-07-17,ES,6340.1750
2026-07-17,NVDA,158.6177
2026-07-17,FX:EUR,1.1078
2026-07-20,AAPL,221.4529
2026-07-20,SAP.DE,241.7559
2026-07-20,ES,6396.9381
2026-07-20,NVDA,157.7804
2026-07-20,FX:EUR,1.1133
2026-07-21,AAPL,221.3866
2026-07-21,SAP.DE,239.3081
2026-07-21,ES,6467.3667
2026-07-21,NVDA,155.4085
2026-07-21,FX:EUR,1.1153
2026-07-22,AAPL,218.0759
2026-07-22,SAP.DE,237.5544
2026-07-22,ES,6507.1164
2026-07-22,NVDA,145.4933
2026-07-22,FX:EUR,1.1154
2026-07-23,AAPL,223.9396
2026-07-23,SAP.DE,240.6298
2026-07-23,ES,6532.9151
2026-07-23,NVDA,145.2205
2026-07-23,FX:EUR,1.1118
2026-07-24,AAPL,223.8021
2026-07-24,SAP.DE,246.4695
2026-07-24,ES,6508.6410
2026-07-24,NVDA,146.8480
2026-07-24,FX:EUR,1.1055
`,
        language: "text",
      },
      {
        path: "tests/test_var.py",
        content: `from riskengine.var import expected_shortfall, historical_var, scale_horizon


def strip(n):
    # P&L of -1, -2, ..., -n shuffled deterministically
    return [-float((i * 37) % n + 1) for i in range(n)]


def test_var_reports_losses_as_positive():
    assert historical_var(strip(250), 0.99) > 0


def test_es_at_least_var():
    pnls = strip(250)
    assert expected_shortfall(pnls, 0.99) >= historical_var(pnls, 0.99)


def test_sqrt_time_scaling():
    assert abs(scale_horizon(100.0, 10) - 316.227766) < 1e-6
`,
      },
      {
        path: "tests/test_exposures.py",
        content: `from riskengine.exposures import position_exposures
from riskengine.fx import FxTable
from riskengine.marketdata import PriceStore
from riskengine.models import Instrument, Position


def store():
    s = PriceStore()
    for f, p in [("SAP.DE", 200.0), ("ES", 6000.0), ("NVDA", 150.0)]:
        s.add(f, "2026-07-01", p)
    return s


FX = FxTable().load_quotes({"EURUSD": 1.10, "USDJPY": 150.0})


def test_fx_quote_conventions():
    assert FX.rates["EUR"] == 1.10
    assert abs(FX.rates["JPY"] - 1 / 150.0) < 1e-12


def test_eur_equity_has_price_and_fx_exposure():
    inst = Instrument("SAP.DE", "equity", "EUR")
    out = position_exposures(Position("B", "SAP.DE", 10), inst, store(), FX, "2026-07-01")
    assert [(e.factor, round(e.base_amount, 6)) for e in out] == [
        ("SAP.DE", 2200.0), ("FX:EUR", 2200.0)]


def test_option_is_delta_adjusted_on_underlying():
    inst = Instrument("C", "option", "USD", underlying="NVDA", multiplier=100, delta=0.5)
    (e,) = position_exposures(Position("B", "C", 2), inst, store(), FX, "2026-07-01")
    assert e.factor == "NVDA" and e.base_amount == 15000.0


def test_short_future_has_no_fx_leg():
    inst = Instrument("ESU6", "future", "USD", underlying="ES", multiplier=50)
    out = position_exposures(Position("B", "ESU6", -2), inst, store(), FX, "2026-07-01")
    assert [(e.factor, e.base_amount) for e in out] == [("ES", -600000.0)]
`,
      },
      {
        path: "tests/test_marketdata.py",
        content: `from riskengine.marketdata import PriceStore
from riskengine.scenarios import build_scenarios


def test_holiday_is_zero_return_then_catch_up():
    s = PriceStore()
    for d, us, eu in [("2026-07-02", 100.0, 50.0), ("2026-07-03", None, 51.0),
                      ("2026-07-06", 110.0, 51.0)]:
        if us is not None:
            s.add("US", d, us)
        s.add("EU", d, eu)
    sc = build_scenarios(s, ["EU", "US"], "2026-07-06", 2)
    assert [x.date for x in sc] == ["2026-07-03", "2026-07-06"]
    assert sc[0].shocks == [("EU", 0.020000000000000018), ("US", 0.0)]
    assert sc[1].shocks[1] == ("US", 0.10000000000000009)
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "mcq",
        title: "Orientation: the risk model in code",
        prompt: "Select **every** statement that is true of the code as written.",
        options: [
          "A EUR stock held by the fund produces two exposures with the same USD amount: one on its price factor, one on `FX:EUR`.",
          "Futures get no FX leg. That is a bug: a EUR future would show no currency risk at all.",
          "On 2026-07-03 (US holiday) the US factors have a 0.0 return in that scenario, and the move is booked on 2026-07-06.",
          "Option exposures include gamma: `delta * underlying` is squared for the convexity term.",
          "A negative diversification benefit means the aggregation is wrong; `diversification_benefit` should clamp it at zero.",
          "Scenarios are ordered oldest first, and `pnl_vector` returns P&L in the same order.",
        ],
        correct: [0, 2, 5],
        hints: [
          "Read the comments in `exposures.py` and `aggregation.py` before judging them.",
          "`price_on` uses `bisect_right(...) - 1`: what does it return for a date with no print?",
        ],
        explanation: `(0) True: the second \`Exposure\` uses the same \`base\` on \`FX:<ccy>\`. (2) True: \`price_on\` forward-fills, so the holiday is a flat day and the catch-up move lands on the reopening date. The visible \`test_marketdata.py\` pins this behaviour. (5) True by construction.

(1) Intentional, not a bug: futures are margined daily, so only the small unrealised P&L sits in foreign currency, not the notional. (3) The linear engine is delta-only, as the comment says. (4) Historical VaR is **not sub-additive**, so standalone VaRs can sum to *less* than portfolio VaR when tail losses concentrate. The docstring says so explicitly and the limits team alerts on it. Clamping would hide a real signal.`,
        timeLimitSec: 300,
        focusFile: "README.md",
      },
      {
        id: "s2",
        kind: "trace",
        title: "Trace one overnight run",
        prompt: "Order what happens when `python3 main.py` runs, from config to report.",
        items: [
          "`load_config` parses `config/risk.toml` into a frozen `RiskConfig`",
          "`PriceStore.from_csv` loads prices; `FxTable.load_quotes` stores EURUSD as USD per EUR",
          "`portfolio_exposures` → `position_exposures` per position (`price_on` at as-of, `fx.to_base`)",
          "`build_scenarios` → `calendar.window` picks the last lookback+1 global dates",
          "`PriceStore.aligned_returns` forward-fills each factor onto those dates",
          "`pnl_vector` computes the portfolio P&L per scenario",
          "`historical_var` on the portfolio P&L",
          "`standalone_var` re-runs `pnl_vector` per book via `pnl_by_book`",
          "`expected_shortfall` and `scale_horizon` while constructing `RiskResult`",
          "`report.render`",
        ],
        hints: [
          "In `engine.run`, look at which values are computed as statements and which only inside the `RiskResult(...)` call.",
        ],
        explanation: "The subtle step is the end of `engine.run`: `total` and `by_book` are computed as separate statements, while ES and every `scale_horizon` call happen inside the `RiskResult(...)` constructor arguments, i.e. after the per-book work. Note also that `pnl_vector` runs once for the portfolio and once per book. That multiplies whatever it costs, which matters in stage 6.",
        timeLimitSec: 360,
        focusFile: "riskengine/engine.py",
      },
      {
        id: "s3",
        kind: "predict",
        title: "Model Validation's sanity strip",
        prompt: `MV sent a hand-checkable 20-day P&L strip. Predict **exactly** what \`python3 scripts/var_check.py\` prints with the current \`var.py\`.

Sorted P&L: \`-40, -30, -22.5, -18, -12, -9, -7, -3, -1.5, -0.5, 1, 2, 3.5, 4, 5, 6.5, 8, 9, 11, 15\`.`,
        entry: "scripts/var_check.py",
        answer: `0.99 k=1 VaR=30.0 ES=40.0
0.95 k=2 VaR=22.5 ES=35.0
0.90 k=2 VaR=22.5 ES=35.0`,
        options: [
          `0.99 k=1 VaR=30.0 ES=40.0
0.95 k=2 VaR=22.5 ES=35.0
0.90 k=2 VaR=22.5 ES=35.0`,
          `0.99 k=1 VaR=40.0 ES=40.0
0.95 k=1 VaR=40.0 ES=40.0
0.90 k=2 VaR=30.0 ES=35.0`,
          `0.99 k=1 VaR=30.0 ES=40.0
0.95 k=1 VaR=30.0 ES=40.0
0.90 k=2 VaR=22.5 ES=35.0`,
          `0.99 k=1 VaR=40.0 ES=40.0
0.95 k=2 VaR=30.0 ES=35.0
0.90 k=2 VaR=30.0 ES=35.0`,
          `0.99 k=1 VaR=30.0 ES=40.0
0.95 k=1 VaR=30.0 ES=40.0
0.90 k=1 VaR=30.0 ES=40.0`,
        ],
        hints: [
          "`ordered[k]` with `k` the tail count: is that the k-th worst (1-indexed)?",
          "Compute `1 - 0.95` in binary floating point. Is it exactly 0.05? What about `1 - 0.9`?",
          "`(1 - 0.95) * 20 == 1.0000000000000009`, `(1 - 0.9) * 20 == 1.9999999999999996`, `(1 - 0.99) * 20 == 0.20000000000000018`.",
        ],
        explanation: `Two independent bugs, and they partly cancel, which is why nobody noticed.

**Float noise in \`tail_count\`.** \`1 - 0.95\` is \`0.050000000000000044\`, so \`n*(1-c)\` for n=20 is \`1.0000000000000009\` and \`ceil\` gives **2** instead of 1. For c=0.90, \`1 - 0.9 = 0.09999999999999998\`, giving \`1.9999999999999996\` → \`ceil\` = 2, which happens to be right. For c=0.99 the product is 0.2 → 1, also right.

**Off-by-one in \`historical_var\`.** With 0-based Python lists the k-th worst is \`ordered[k-1]\`, not \`ordered[k]\`. So VaR is always one scenario too benign: at 0.99 it reports 30 (2nd worst) instead of 40.

ES uses \`ordered[:k]\`, which is the right *count* for a given \`k\`, so ES is only wrong when \`k\` itself is inflated (0.95 → mean of the two worst = 35 instead of 40).

Result: VaR at 0.95 equals VaR at 0.90 and ES at 0.95 equals ES at 0.90, a monotonicity violation MV would flag immediately. The correct output is \`40/40\`, \`40/40\`, \`30/35\`.`,
        timeLimitSec: 540,
        focusFile: "riskengine/var.py",
      },
      {
        id: "s4",
        kind: "code",
        task: "fix",
        title: "Fix the tail convention",
        prompt: "Make `var.py` implement the README convention exactly: `k = ceil(n·(1−c))` evaluated as the *mathematical* value (so n=20, c=0.95 gives k=1 and n=500, c=0.99 gives k=5), VaR is the k-th worst loss (1-indexed), ES the mean of the k worst losses. Losses stay positive. The tail must never be empty.",
        editable: ["riskengine/var.py"],
        tests: [
          {
            path: "tests/test_hidden_var.py",
            content: `import random

from riskengine.var import expected_shortfall, historical_var, tail_count


def ranked(n, seed=3):
    """Losses 1..n (as P&L -1..-n) in a deterministic shuffled order."""
    xs = [-float(i) for i in range(1, n + 1)]
    random.Random(seed).shuffle(xs)
    return xs


def test_tail_count_matches_convention():
    assert tail_count(250, 0.99) == 3
    assert tail_count(500, 0.99) == 5
    assert tail_count(20, 0.95) == 1
    assert tail_count(200, 0.975) == 5
    assert tail_count(100, 0.99) == 1
    assert tail_count(20, 0.90) == 2
    assert tail_count(1000, 0.999) == 1


def test_var_is_kth_worst_loss():
    assert historical_var(ranked(250), 0.99) == 248.0   # 3rd worst of 1..250
    assert historical_var(ranked(500), 0.99) == 496.0   # 5th worst of 1..500
    assert historical_var(ranked(100), 0.99) == 100.0   # the worst day


def test_es_averages_exactly_k_losses():
    assert expected_shortfall(ranked(500), 0.99) == (500 + 499 + 498 + 497 + 496) / 5
    assert expected_shortfall(ranked(20), 0.95) == 20.0


def test_var_monotone_in_confidence():
    pnls = ranked(250, seed=9)
    levels = [0.90, 0.95, 0.975, 0.99, 0.995]
    vs = [historical_var(pnls, c) for c in levels]
    assert vs == sorted(vs)
    for c in levels:
        assert expected_shortfall(pnls, c) >= historical_var(pnls, c)
`,
            hidden: true,
          },
        ],
        solution: {
          "riskengine/var.py": `"""Historical VaR and Expected Shortfall. Conventions: see README (MV-2291)."""
import math


def tail_count(n, confidence):
    """Number of scenarios in the tail: k = ceil(n * (1 - confidence)).

    n * (1 - c) is computed in binary floating point: (1 - 0.95) * 20 is
    1.0000000000000009, which a bare ceil() turns into 2. Round away the
    representation noise first, and never return an empty tail."""
    if n <= 0:
        raise ValueError("no scenarios")
    return max(1, math.ceil(round(n * (1 - confidence), 9)))


def historical_var(pnls, confidence):
    """Loss (positive) of the k-th worst scenario (1-indexed)."""
    ordered = sorted(pnls)
    k = tail_count(len(ordered), confidence)
    return -ordered[k - 1]


def expected_shortfall(pnls, confidence):
    """Average loss (positive) of the k worst scenarios."""
    ordered = sorted(pnls)
    k = tail_count(len(ordered), confidence)
    return -sum(ordered[:k]) / k


def scale_horizon(one_day, days):
    """Square-root-of-time scaling. Assumes i.i.d. daily P&L."""
    return one_day * math.sqrt(days)
`,
        },
        hints: [
          "Two separate changes: the index and the count.",
          "Remove representation noise before `ceil`: `round(n * (1 - c), 9)`, or do the arithmetic in `fractions.Fraction(str(c))` / `decimal.Decimal(str(c))`.",
        ],
        explanation: `\`ceil\` and \`floor\` are discontinuous, so they amplify a 1-ulp error into a whole extra scenario. Anything that feeds a float into \`ceil\` should either round to a sane precision first or use exact arithmetic (\`Fraction(str(c))\` gives exactly 1/20 for 0.95). Then index with \`k - 1\`. Guard with \`max(1, k)\` so that c close to 1 never yields an empty tail (ES would divide by zero, VaR would read \`ordered[-1]\`, the *best* day).

Why tests at n=250 hid this: \`(1-0.99)*250 = 2.5000000000000022\` → \`ceil\` = 3 is correct, and the only visible tests check VaR > 0 and ES ≥ VaR, both of which hold under the bug. Tests that pin exact order statistics on a known ranked strip are the only way to test a quantile convention.`,
        timeLimitSec: 720,
        focusFile: "riskengine/var.py",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "Review the assistant's speed-up",
        prompt: "The job overran its window. You ask the assistant to speed up scenario generation. Review its patch.",
        persona: "confident-intern",
        request: "build_scenarios is slow on the 250-day window (one bisect per factor per date). Make it faster without changing results.",
        aiReply: `\`build_scenarios\` is slow because \`aligned_returns\` does a \`bisect\` for every (factor, date). Each factor's own history already gives us its returns, so compute them once and slice:

\`\`\`python
# riskengine/scenarios.py
from .calendar import window
from .models import Scenario


def build_scenarios(store, factors, asof, lookback):
    """Vectorised: one pass per factor over its own price series."""
    dates = window(store.calendar(), asof, lookback)
    rets = {}
    for f in factors:
        px = [p for d, p in store.series(f) if d <= asof]
        r = [b / a - 1.0 for a, b in zip(px, px[1:])]
        rets[f] = r[-lookback:]          # last \`lookback\` daily returns
    return [
        Scenario(date=dates[i + 1], shocks=sorted((f, rets[f][i]) for f in factors))
        for i in range(lookback)
    ]
\`\`\`

No more forward-fill lookups: about 6x faster on the 250-day window, and the output is identical because simple returns telescope. All tests pass ✅`,
        options: [
          "Accept: simple returns telescope, so computing them on each factor's own series gives identical numbers.",
          "Reject: each factor's own series skips its local holidays, so its last `lookback` returns no longer line up with `dates`. Every US return before 2026-07-03 shifts by one scenario (the 07-03 scenario pairs SAP's 07-03 move with the US move of 07-02, and so on back through the window), so cross-factor co-movements are corrupted; a short series even raises IndexError. Keep alignment to the global calendar, e.g. forward-fill each series once in a linear merge.",
          "Reject: historical simulation must use log returns; simple returns overstate losses.",
          "Reject: `sorted((f, r) ...)` orders shocks by return value, which breaks `_shock` lookups.",
          "Reject: `d <= asof` must be `d < asof`, because the as-of close is not final when the batch runs.",
        ],
        correct: 1,
        hints: [
          "Run the visible `tests/test_marketdata.py` against the patch in your head: how many returns does the US series produce?",
          "Scenario `i` is dated `dates[i + 1]`. Is `rets[f][i]` the return *into* that date for every factor?",
        ],
        explanation: `Historical simulation is only meaningful if each scenario is a **cross-section of one day**: every factor's return from the same date to the same next date. The original code guarantees that by evaluating every factor on the global calendar with forward-fill. The patch computes returns on each factor's *own* trading days, so a factor that skipped 07-03 has one fewer return. Slicing the last \`lookback\` returns keeps the days after the holiday aligned (the 07-02→07-06 catch-up still lands on 07-06), but shifts every US return *before* the holiday by one position relative to \`dates\`: the 07-03 scenario pairs SAP's 07-03 move with the US move of 07-02, and the oldest scenario gets a return from outside the window. The numbers look plausible and the totals are close, but correlations (the reason HS VaR exists) are corrupted. In the visible test the US series has 1 return for a 2-scenario window, so \`rets['US'][1]\` raises \`IndexError\`. The assistant's "all tests pass" is false.

The other options: log vs simple returns is a modelling choice, not a bug here, since the linear P&L uses simple returns consistently. Tuples sort by their first element (the factor name). The \`<= asof\` filter matches \`calendar.window\`.

A correct speed-up keeps alignment: walk each factor's sorted series and the global calendar together once (O(dates + prints)), carrying the last price forward.`,
        timeLimitSec: 480,
        focusFile: "riskengine/scenarios.py",
      },
      {
        id: "s6",
        kind: "code",
        task: "optimise",
        title: "Make P&L fit the batch window",
        prompt: `After the new fund was onboarded, \`pnl_vector\` became the bottleneck: 20,000 exposures, 600 factors, 750 scenarios. Make it fast (the hidden test allows **1.5 s** for that size) while keeping the contract:

* same results (to floating-point tolerance), in scenario order;
* still raises \`KeyError\` if a referenced factor is missing from a scenario;
* factors no exposure references are ignored; no exposures → all-zero P&L.

Pure Python only (no numpy on the batch host).`,
        editable: ["riskengine/pnl.py"],
        tests: [
          {
            path: "tests/test_hidden_pnl_perf.py",
            content: `import random
import time

from riskengine.models import Exposure, Scenario
from riskengine.pnl import pnl_vector


def make(n_factors=600, n_exposures=20000, n_scenarios=750, seed=5):
    rng = random.Random(seed)
    factors = ["F%03d" % i for i in range(n_factors)]
    exposures = [
        Exposure("B%d" % (i % 7), "p%d" % i, rng.choice(factors), rng.uniform(-1e6, 1e6))
        for i in range(n_exposures)
    ]
    scenarios = [
        Scenario("D%03d" % s, sorted((f, rng.gauss(0, 0.02)) for f in factors))
        for s in range(n_scenarios)
    ]
    return exposures, scenarios


def reference(exposures, scenarios):
    out = []
    for sc in scenarios:
        m = dict(sc.shocks)
        out.append(sum(e.base_amount * m[e.factor] for e in exposures))
    return out


def test_small_matches_definition():
    ex, sc = make(n_factors=5, n_exposures=40, n_scenarios=30)
    got = pnl_vector(ex, sc)
    want = reference(ex, sc)
    assert len(got) == len(want)
    for g, w in zip(got, want):
        assert abs(g - w) <= 1e-6 * max(1.0, abs(w))


def test_missing_factor_still_raises():
    ex = [Exposure("B", "p", "MISSING", 1.0)]
    sc = [Scenario("D1", [("A", 0.01)])]
    try:
        pnl_vector(ex, sc)
        assert False, "expected KeyError"
    except KeyError:
        pass


def test_unreferenced_factors_are_fine_and_empty_is_zero():
    sc = [Scenario("D1", [("A", 0.01), ("B", 0.02)])]
    assert pnl_vector([], sc) == [0.0]
    assert pnl_vector([Exposure("X", "p", "B", 100.0)], sc) == [2.0]


def test_full_book_is_fast():
    ex, sc = make()
    t0 = time.perf_counter()
    got = pnl_vector(ex, sc)
    elapsed = time.perf_counter() - t0
    want = reference(ex[:], sc[:3])
    for g, w in zip(got[:3], want):
        assert abs(g - w) <= 1e-6 * max(1.0, abs(w))
    assert len(got) == 750
    assert elapsed < 1.5, "pnl_vector took %.2fs" % elapsed
`,
            hidden: true,
          },
        ],
        solution: {
          "riskengine/pnl.py": `"""Linear scenario P&L."""


def _net_by_factor(exposures):
    """Collapse exposures onto factors first: P&L is linear, so
    sum_e a_e * r_f(e) == sum_f (sum_{e on f} a_e) * r_f."""
    net = {}
    for e in exposures:
        net[e.factor] = net.get(e.factor, 0.0) + e.base_amount
    return net


def pnl_vector(exposures, scenarios):
    """P&L of the whole exposure set under each scenario, in scenario order:
    pnl[s] = sum(e.base_amount * return of e.factor in scenario s).
    Raises KeyError if an exposure's factor is missing from a scenario."""
    net = list(_net_by_factor(exposures).items())
    out = []
    for sc in scenarios:
        shocks = dict(sc.shocks)
        total = 0.0
        for factor, amount in net:
            try:
                total += amount * shocks[factor]
            except KeyError:
                raise KeyError("no shock for %s on %s" % (factor, sc.date)) from None
        out.append(total)
    return out


def pnl_by_book(exposures, scenarios):
    books = {}
    for e in exposures:
        books.setdefault(e.book, []).append(e)
    return {b: pnl_vector(es, scenarios) for b, es in sorted(books.items())}
`,
        },
        timeoutMs: 6000,
        hints: [
          "Current cost: S × P × (F/2) comparisons because `_shock` scans a list. What is the cheapest fix for the scan?",
          "P&L is linear: Σₑ aₑ·r_f(e) = Σ_f (Σ_{e on f} aₑ)·r_f. Net the exposures per factor once, before looping over scenarios.",
        ],
        explanation: `Two independent wins:

1. **Turn the scan into a lookup:** \`dict(sc.shocks)\` once per scenario makes each shock O(1). That alone takes S×P×F/2 ≈ 4.5·10⁹ comparisons down to S×P = 1.5·10⁷ lookups.
2. **Exploit linearity:** net exposures per factor first (O(P)), then each scenario is a dot product over at most F factors: O(P + S·F) ≈ 4.7·10⁵ operations. Positions can now triple without the runtime noticing.

Keep the \`KeyError\` contract by looking up the netted factors and re-raising with a useful message. Summation order changes, so results differ in the last few ulps. Tests compare with a relative tolerance, as any reconciliation against MV should. Netting also helps \`pnl_by_book\`, which \`engine.run\` calls once per book.`,
        timeLimitSec: 780,
        focusFile: "riskengine/pnl.py",
      },
      {
        id: "s7",
        kind: "mcq",
        title: "Follow-up: regulatory horizon and a bigger book",
        prompt: "The risk committee wants **10-day 99% VaR on a 500-day lookback**, and AUM will triple as two more funds onboard. Select **all** true statements.",
        options: [
          "`scale_horizon` (√10 scaling) assumes i.i.d. daily P&L; volatility clustering and autocorrelation make it unreliable in the tail. Overlapping 10-day returns are an alternative, but they produce strongly autocorrelated scenarios.",
          "With n=500 and c=0.99 the number is driven by just k=5 scenarios, so one crisis week entering or leaving the window can make VaR jump (the \"ghost effect\"); monitor day-over-day scenario attribution.",
          "Desk limits can safely be set so that desk VaRs add up to the firm limit, because the sum of standalone VaRs always bounds the portfolio VaR.",
          "After the stage-6 change the P&L cost is O(P + S·F): tripling positions barely changes runtime, while doubling the lookback roughly doubles it.",
          "Doubling the lookback roughly halves VaR, because the extra scenarios dilute the tail.",
        ],
        correct: [0, 1, 3],
        hints: [
          "Re-read the docstring of `diversification_benefit`.",
          "Where does P appear in the new complexity?",
        ],
        explanation: `(0) √t scaling is exact only for i.i.d. normal-ish returns; regulators accept it with caveats, and overlapping windows trade one bias for autocorrelation. (1) Small k makes HS VaR step-like; good risk systems report which scenario dates drive the tail each day. (3) After netting, P only enters once; S (lookback) and F dominate.

(2) False: historical VaR is not sub-additive, so the firm VaR can *exceed* the sum of desk VaRs (the code even alerts on a negative diversification benefit). ES is the coherent alternative, which is one reason FRTB moved to 97.5% ES. (4) False: a longer window changes *which* days are in the tail, not their size; VaR can go up or down, and calm windows often go up when a stress period is included.`,
        timeLimitSec: 360,
      },
    ],
  },
];

export default problems;
