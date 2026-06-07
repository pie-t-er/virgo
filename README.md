# Virgo — AI Wardrobe Agent

A conversational wardrobe management agent built for the [Google Cloud Rapid Agent Hackathon](https://googlecloudmultiagents.devpost.com/) (MongoDB track).

**Live demo:** [https://virgo-85048588163.us-central1.run.app](https://virgo-85048588163.us-central1.run.app)

---

## Features

- **Clothing catalog** — add items in natural language; stored in MongoDB Atlas with semantic embeddings
- **Outfit recommendations** — Atlas Vector Search finds the best matches for any occasion or mood
- **Weekly calendar** — plan outfits day-by-day; agent avoids repeat combinations automatically
- **Shopping gap analysis** — identifies missing wardrobe essentials based on outfit templates

---

## Stack

| Layer | Technology |
|---|---|
| Agent framework | Google ADK (Python) |
| LLM | Gemini 2.0 Flash |
| Embeddings | Gemini text-embedding-004 |
| Database | MongoDB Atlas (M0 free tier) |
| Vector search | Atlas Vector Search (cosine, 3072-dim) |
| Backend API | FastAPI + uvicorn |
| Frontend | React + Vite |
| Hosting | Google Cloud Run |

---

## Local setup

### Prerequisites
- Python 3.12+
- Node 20+
- MongoDB Atlas account (free M0 cluster)
- Google AI Studio API key

### 1. Clone & configure

```bash
git clone https://github.com/pie-t-er/virgo.git
cd virgo
cp .env.example .env
# edit .env with your keys
```

### 2. Backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Seed data

Place `macysM.csv` and `macysW.csv` in the `scripts/` directory, then:

```bash
python -m backend.seed
```

This generates Gemini embeddings and populates `wardrobe_items` + `outfit_templates` in Atlas.

### 4. Atlas Vector Search index

In the Atlas UI, create a Vector Search index on the `wardrobe_items` collection:

```json
{
  "fields": [{
    "type": "vector",
    "path": "embedding",
    "numDimensions": 3072,
    "similarity": "cosine"
  }]
}
```

Name the index `wardobe_vector_index`.

### 5. Run backend

```bash
uvicorn backend.main:app --reload --port 8000
```

### 6. Run frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` (proxies `/api` to backend).

---

## Deploy to Cloud Run

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions _GOOGLE_API_KEY=<key>,_MONGODB_URI=<uri>
```

---

## License

MIT — see [LICENSE](LICENSE).
