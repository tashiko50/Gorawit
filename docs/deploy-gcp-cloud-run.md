# Deploying Run Mile to Google Cloud Run

This app is a plain Node.js/Express server with no Render-specific code, so it
runs the same way on Cloud Run. This doc is written for whoever ends up with
access to the company GCP project — it assumes no GCP experience beyond having
an account with permission to create resources in the target project.

## What you'll need before starting

- A GCP project with billing enabled — the company project ID is
  `sbx-gorawit` (already set up, with Cloud Run / Cloud Build / Artifact
  Registry / Logging / Monitoring APIs enabled)
- `gcloud` CLI installed locally, or use Cloud Shell in the GCP Console (no
  local install needed — everything below works there too)
- The same environment variable values currently set on Render (check the
  Render dashboard → this service → Environment tab):
  - `SHEET_CSV_URL` (has a working default baked into the code already, so
    only needed if the sheet is ever recreated)
  - `VISIT_COUNTER_URL` (the Apps Script Web App URL — keeps the visit
    counter persistent across restarts; copy this value as-is, it's not
    tied to Render)
  - `SHEET_POLL_MS`, `WEATHER_POLL_MS`, `WEATHER_API_BASE` (optional,
    only if changed from defaults)

## One-time setup

```bash
# Log in and pick the project
gcloud auth login
gcloud config set project sbx-gorawit

# APIs are already enabled on this project — no need to run
# `gcloud services enable ...` unless a future feature needs a new one.
```

## Deploy

From the repo root (where the `Dockerfile` lives):

```bash
gcloud run deploy run-mile \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 \
  --max-instances 2 \
  --memory 256Mi \
  --set-env-vars "VISIT_COUNTER_URL=PASTE_THE_APPS_SCRIPT_URL_HERE"
```

Notes on the flags:
- `--source .` — Cloud Run builds the container from the `Dockerfile` in this
  repo automatically, no need to build/push an image by hand.
- `--region asia-southeast1` — Singapore, matches the Render region already
  in use; keeps latency to the Google Sheet and to Thailand-based users low.
- `--allow-unauthenticated` — the site is meant to be publicly viewable, same
  as on Render.
- `--min-instances 0` — scales to zero when idle, so there's no cost while
  nobody's viewing it. (Cold starts on a small app like this are typically
  1-2 seconds, much faster than Render's free-tier ~30-60s sleep wake-up.)
  Set this to `1` instead if even that occasional cold-start delay is
  undesirable — at that point it's always warm, at a small always-on cost.
- `--memory 256Mi` — plenty for this app; lower than Cloud Run's 512Mi
  default, which trims cost slightly.
- Add more `--set-env-vars` (comma-separated, no spaces) for any other
  variable you're carrying over from Render.

The command prints a `*.run.app` URL when it finishes — that's the new
site address. Point the company's usual short link / any bookmarks at it
once confirmed working.

Budget note: the project has a ~฿1,000/month budget with alerts at
50/90/100% — these are notifications only, not an automatic cutoff. Cloud
Run itself costs nothing while idle (no traffic = no charge), so this
deploy alone won't burn the budget. Only worry about turning things off if
some other resource (a Compute Engine VM, Cloud SQL, etc.) gets created
and left running — Cloud Run isn't that kind of resource.

## After deploying

- Open the printed URL and check the map loads, teams show real km, and the
  Top 10 popup + kiosk mode work.
- To push a future code change: re-run the same `gcloud run deploy` command
  from the updated repo — it rebuilds and rolls out a new revision
  automatically, zero-downtime.
- Cloud Run's free tier (per project, resets monthly) includes 2 million
  requests, 360,000 GB-seconds of memory, and 180,000 vCPU-seconds — for a
  small internal tool like this, likely enough to run entirely free even
  outside Render's tighter bandwidth cap. Actual GCP network egress is
  billed per the company's account, not capped the way Render's free
  Hobby tier is, so a burst of usage won't risk the site going down.

## Rolling back

Cloud Run keeps every previous revision. If a deploy causes a problem:

```bash
gcloud run revisions list --service run-mile --region asia-southeast1
gcloud run services update-traffic run-mile --region asia-southeast1 \
  --to-revisions PREVIOUS_REVISION_NAME=100
```
