# RAG Playground — vectors by hand, then for real

A ~20-minute, local-only exercise to build intuition before writing Phase 4
code ([checklist](phase-4-checklist.md)). No API keys, no repo code changes,
nothing here is production code. Needs Docker; part 2 also needs Node.

What you should come away with:

- a vector is a position on a "map of meaning"; search = "which stored
  points point in the closest direction to my question";
- search **always** returns the top-N, however far away they are — hence
  `limit` (ceiling) **and** a score threshold (floor);
- without a `businessId` filter, another garage's price wins — the tenant
  filter is mandatory, not a nice-to-have;
- real embedding models match meaning, not keywords — and they still fail
  sometimes, which is why Phase 4 has an eval set.

## Part 1 — hand-made 3D vectors in Qdrant

Each chunk gets 3 numbers we pick ourselves:
`[prices, opening hours, warranty]`. Real models use 384–1536 numbers that
nobody labels, but the mechanics are identical.

```bash
docker run -d --name qdrant-playground -p 6333:6333 qdrant/qdrant
```

Open <http://localhost:6333/dashboard> → **Console**, and run each block:

```
PUT collections/garage_demo
{
  "vectors": { "size": 3, "distance": "Cosine" }
}
```

```
PUT collections/garage_demo/points?wait=true
{
  "points": [
    {"id":1,"vector":[0.9,0.1,0.0],"payload":{"businessId":"garage_a","text":"החלפת בלמים: 650 שקל"}},
    {"id":2,"vector":[0.8,0.0,0.2],"payload":{"businessId":"garage_a","text":"טיפול 10,000: 900 שקל"}},
    {"id":3,"vector":[0.1,0.9,0.0],"payload":{"businessId":"garage_a","text":"פתוחים א-ה 8:00-17:00"}},
    {"id":4,"vector":[0.0,0.1,0.9],"payload":{"businessId":"garage_a","text":"אחריות 6 חודשים על כל עבודה"}},
    {"id":5,"vector":[0.9,0.2,0.0],"payload":{"businessId":"garage_b","text":"החלפת בלמים: 800 שקל"}},
    {"id":6,"vector":[0.2,0.8,0.1],"payload":{"businessId":"garage_b","text":"פתוחים א-ו 7:00-14:00"}}
  ]
}
```

**See the map:** Collections → `garage_demo` → Visualize, with:

```
{
  "limit": 10,
  "algorithm": "PCA",
  "color_by": { "payload": "businessId" }
}
```

Use PCA, not the default UMAP — UMAP needs thousands of points and scatters 6
points almost randomly. Expect three clusters by **topic** (prices, hours,
warranty), with both garages mixed inside them: the map knows meaning, not
ownership.

**Search without a filter** — a garage A customer asks about brake prices,
so the query points mostly at "prices":

```
POST collections/garage_demo/points/query
{
  "query": [0.85, 0.15, 0.0],
  "limit": 3,
  "with_payload": true
}
```

Garage **B**'s 800 ₪ comes back first. That's the leak.

**Same search, filtered:**

```
POST collections/garage_demo/points/query
{
  "query": [0.85, 0.15, 0.0],
  "limit": 3,
  "with_payload": true,
  "filter": {
    "must": [ { "key": "businessId", "match": { "value": "garage_a" } } ]
  }
}
```

Now 650 ₪ is first — but the 3rd result is "opening hours" at score 0.28,
returned only because we asked for 3. Add `"score_threshold": 0.7` and it
drops out.

Also try: `"query": [0.1, 0.9, 0.0]` (a question about hours), and
`[0.45, 0.05, 0.0]` (same direction as `[0.9, 0.1, 0]`, half the length —
cosine scores are identical, because only direction counts).

## Part 2 — real embeddings (local model, free)

Uses `paraphrase-multilingual-MiniLM-L12-v2` (supports Hebrew, 384 dims,
~120 MB download from HuggingFace, runs on CPU). This is **not** the model
chosen for the project (OpenAI `text-embedding-3-small`, 1536 dims) — it's
just a free way to see real vectors. Run it in a scratch folder **outside
the repo**:

```bash
mkdir rag-demo && cd rag-demo && npm init -y && npm install @huggingface/transformers@3
```

Save as `demo.mjs` (Qdrant from part 1 must be running):

```js
import { pipeline, env } from "@huggingface/transformers";
// Windows: a short cache path avoids MAX_PATH "file doesn't exist" errors.
env.cacheDir = `${process.env.HOME ?? process.env.USERPROFILE}/.cache/hf-embed-demo`;

const Q = "http://localhost:6333";
const C = "garage_real";
const embed = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2", {
  dtype: "q8",
});
const vec = async (t) => Array.from((await embed(t, { pooling: "mean", normalize: true })).data);
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const json = (method, path, body) =>
  fetch(`${Q}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  }).then((r) => r.json());

const chunks = [
  ["garage_a", "מחיר החלפת בלמים קדמיים: 650 שקל כולל עבודה"],
  ["garage_a", "טיפול 10,000 קילומטר: 900 שקל, כולל החלפת שמן ומסננים"],
  ["garage_a", "שעות פתיחה: ראשון עד חמישי 8:00-17:00, שישי סגור"],
  ["garage_a", "אחריות של 6 חודשים על כל עבודה שבוצעה במוסך"],
  ["garage_a", "בדיקת מצבר ומערכת הצתה ללא עלות"],
  ["garage_a", "בדיקת מזגן ומילוי גז: 350 שקל"],
  ["garage_a", "יש חניה ללקוחות בחצר המוסך"],
  ["garage_b", "מחיר החלפת בלמים: 800 שקל"],
  ["garage_b", "שעות פתיחה: ראשון עד שישי 7:00-14:00"],
];
const vectors = [];
for (const [, t] of chunks) vectors.push(await vec(t));
console.log(
  `dims: ${vectors[0].length}; first numbers:`,
  vectors[0].slice(0, 6).map((x) => x.toFixed(3)),
);

await json("DELETE", `/collections/${C}`);
await json("PUT", `/collections/${C}`, {
  vectors: { size: vectors[0].length, distance: "Cosine" },
});
await json("PUT", `/collections/${C}/points?wait=true`, {
  points: chunks.map(([businessId, text], i) => ({
    id: i + 1,
    vector: vectors[i],
    payload: { businessId, text },
  })),
});

async function search(q, businessId) {
  const body = { query: await vec(q), limit: 3, with_payload: true };
  if (businessId) body.filter = { must: [{ key: "businessId", match: { value: businessId } }] };
  const r = await json("POST", `/collections/${C}/points/query`, body);
  console.log(`\n${q}${businessId ? ` [${businessId}]` : " [NO FILTER]"}`);
  for (const p of r.result.points)
    console.log(`  ${p.score.toFixed(3)}  ${p.payload.businessId}  ${p.payload.text}`);
}
await search("כמה עולה להחליף בלמים?", "garage_a");
await search("אם משהו יתקלקל אחרי התיקון, אתם מכסים?", "garage_a");
await search("האוטו לא נדלק בבוקר, מה עושים?", "garage_a");
await search("כמה עולה להחליף בלמים?");

for (const [a, b] of [
  ["כמה זה יוצא לי?", "מחיר החלפת בלמים: 650 שקל"],
  ["הרכב צריך טיפול", "טיפול פסיכולוגי"],
  ["הרכב צריך טיפול", "טיפול 10,000 קילומטר לרכב"],
  ["מאזדה 3", "מאזדה 6"],
])
  console.log(`${cos(await vec(a), await vec(b)).toFixed(3)}  ${a}  <->  ${b}`);
```

```bash
node demo.mjs
```

### What we saw (2026-09-22)

| Question (filtered to garage A)        | Top result                              | Score |
| -------------------------------------- | --------------------------------------- | ----- |
| כמה עולה להחליף בלמים?                 | brakes 650 ₪ ✅                         | 0.62  |
| אם משהו יתקלקל אחרי התיקון, אתם מכסים? | 6-month warranty ✅                     | 0.28  |
| האוטו לא נדלק בבוקר, מה עושים?         | opening hours ❌ (wanted battery check) | 0.46  |
| (no filter) כמה עולה להחליף בלמים?     | garage **B** 800 ₪ ❌ leak              | 0.76  |

| Pair                                                                           | Score   |
| ------------------------------------------------------------------------------ | ------- |
| "the car needs a service" ↔ "10,000 km car service"                            | 0.64    |
| "the car needs a service" ↔ "psychological therapy" (same Hebrew word, טיפול)  | 0.34    |
| "how much will it cost me?" ↔ "brake replacement price: 650" (no shared words) | 0.51    |
| "Mazda 3" ↔ "Mazda 6"                                                          | 0.79 ⚠️ |

Takeaways that feed the Phase 4 checklist:

1. **Meaning, not keywords** — the warranty question shares no words with
   the warranty chunk and still finds it; `טיפול` for a car vs therapy is
   told apart by context.
2. **The tenant filter is mandatory** — unfiltered, the other garage's price
   ranks first on real embeddings too.
3. **Tune the threshold on data** — the correct warranty match scored 0.28,
   below the wrong "car won't start" match at 0.46. A guessed threshold
   would cut the right answer.
4. **Models miss** — 1 of 5 questions got the wrong chunk, and near-identical
   entities (Mazda 3 vs 6) look the same. Hence the eval set and, later,
   hybrid lexical search.

### How the embedding model works (one paragraph)

The text is split into sub-word tokens (`בלמים` → `בל` + `מים` — "water"!),
each token gets a starting vector from a lookup table, then 12 transformer
layers let every token "look at" its neighbours (attention) and update its
numbers — so `מים` next to `בל`/`להחליף` ends up meaning brakes, not water.
The token vectors are averaged (`pooling: "mean"`) and scaled to length 1
(`normalize: true`). The weights were learned by showing the model millions
of sentence pairs and nudging same-meaning pairs together and random pairs
apart. Same architecture family as a chat model like Claude; the difference
is the output — one vector, instead of the next word.

## Clean up

```bash
docker rm -f qdrant-playground
```

Delete the `rag-demo` folder, and the model cache in `~/.cache/hf-embed-demo`
(~120 MB) if you don't want to keep it.
