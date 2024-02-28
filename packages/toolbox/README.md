# @diachronic/toolbox


## Versioned Workflow Deployments
This package includes code that runs versioned CI deployment and a development loop for Temporal workflows.

## Reloadable Temporal Workers

The script uploads workflow bundles to a Google Cloud Bucket and generates a signed URL 
for the worker to download the bundle from. This is intended for development use only right now. 
For production use we must give the worker a secure way to download the artifacts that spans an indefinite duration.

### Usage
Impersonate a service account that can create signed URLs for the bucket.
```shell
gcloud auth application-default login --impersonate-service-account hello@gcp-project.iam.gserviceaccount.com
```

You should be able to run any dev script that uses the reloadable worker API (`createReloadableWorkerPipeline`) and see it run the Google Storage steps successfully.
