# Deploy runbook

To deploy the latest `main` to production, give the user these exact Cloud Shell steps
(the user runs these themselves at https://shell.cloud.google.com, logged in as `tdfb`):

1. Open shell.cloud.google.com (logged in as `tdfb`)
2. `cd gorawit && git pull` (if the repo isn't cloned yet: `git clone https://github.com/tashiko50/Gorawit.git gorawit && cd gorawit`)
3. `gcloud config set project sbx-gorawit`
4. Deploy (single line):

```bash
gcloud run deploy run-mile --source . --region asia-southeast1 --allow-unauthenticated --port 8080 --min-instances 0 --max-instances 2 --memory 256Mi --set-env-vars "VISIT_COUNTER_URL=https://script.google.com/macros/s/AKfycbx4TVIJVDLulLoacaQNdosqTYtulb8gtliXVjyNa-2s-jITO8OeVvjlkvTQZ0etKq65xA/exec"
```

Project: `sbx-gorawit`. Region: `asia-southeast1`. Service name: `run-mile`.
