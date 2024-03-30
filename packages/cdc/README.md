# @diachronic/cdc

> Parse Temporal database streams with Apache Spark

Pyspark notebooks are available in `src`.

## Steps

### Generate protobuf descriptor file

Generate protobuf descriptor file. we use one from temporal-api@135691242e9b4ed6214a7b5e1231c1c9930ff6c8.
This should correspond to the version of Temporal we are using.


Descriptor file is committed in this package. It works with Temporal v1.22 and was generated with
libprotoc 24.3 from the following:

```shell
git clone https://github.com/temporalio/api.git

protoc -I . \
    temporal/api/history/v1/message.proto \
    -o descriptors.binpb \
    --include_imports \
    --include_source_info
```

### Use the descriptor to decode the protobuf data in the history_node table

With Debezium CDC connector for Postgres the CDC records have the following schema:
```sparksql
 CREATE TABLE spark_catalog.temporal.history_node_cdc
 (
     key           STRUCT<shard_id : INT, tree_id : BINARY, branch_id : BINARY, node_id : BIGINT, txn_id : BIGINT>,
     value         STRUCT<before : STRUCT<shard_id : INT, tree_id : BINARY, branch_id : BINARY, node_id : BIGINT, txn_id
                                          : BIGINT, data : BINARY, data_encoding : STRING, prev_txn_id : BIGINT>
     , after : STRUCT<shard_id : INT, tree_id : BINARY, branch_id : BINARY, node_id : BIGINT, txn_id
                      : BIGINT, data : BINARY, data_encoding : STRING, prev_txn_id : BIGINT>, source
         : STRUCT<version : STRING, connector : STRING, name : STRING, ts_ms : BIGINT, snapshot
                  : STRING, db : STRING, sequence : STRING, schema : STRING, table : STRING, txId
                  : BIGINT, lsn : BIGINT, xmin : BIGINT>, op : STRING, ts_ms : BIGINT, transaction
         : STRUCT<id : STRING, total_order : BIGINT, data_collection_order : BIGINT>>,
     offset        BIGINT,
     timestamp     BIGINT,
     _rescued_data STRING
 ) USING delta TBLPROPERTIES (
        'delta.minReaderVersion' = '1',
        'delta.minWriterVersion' = '2'
        )
```

`data` contains protobuf data that can be decoded using the descriptor file:

```python
from pyspark.sql.functions import *
from pyspark.sql.protobuf.functions import from_protobuf

df = df.withColumn(
    "proto",
    from_protobuf(
        df.data,
        "History",
        descFilePath='/path/to/descriptor/file',
        options={"recursive.fields.max.depth": "2"},
    ),
).select(
    # Primary key columns (in this order)
    "shard_id",
    "tree_id",
    "branch_id",
    "node_id",
    "txn_id",
    # Adds a row per item in the history array entry. The array item is stored in the entry column and star-expended in the next step
    explode("proto.events").alias("entry"),
    "prev_txn_id",
).select(
    # Repeat all fields from above
    "shard_id",
    "tree_id",
    "branch_id",
    "node_id",
    "txn_id",
    "prev_txn_id",
    # Star expand the history entry, effectively adding a column per history event type to the table
    "entry.*",
)
```

For batch processing we can use windows. Streaming workloads can replace the same with self-joins. In either case it's 
a bit complicated to get a coherent story from the data similar to what we see in the Temporal UI.

```python
from pyspark.sql.window import Window

# Adds a column workflow_info to each row, where workflow_info is the execution start event of each workflow
with_wf_info = (
    df.withColumn(
        "workflow_info",
        first(
            df.workflow_execution_started_event_attributes,
            ignorenulls=True,
        ).over(
            Window.partitionBy("shard_id", "tree_id").orderBy(
                -col("txn_id")
            )
        ),
    )
    .withColumn(
        "run_id",
        coalesce(
            first(
                col("workflow_task_failed_event_attributes.new_run_id"),
                ignorenulls=True,
            ).over(
                Window.partitionBy("shard_id", "tree_id", "branch_id").orderBy(
                    -col("txn_id")
                )
            ),
            col("workflow_info.original_execution_run_id"),
        ),
    )
    .withColumn("workflow_id", col("workflow_info.workflow_id"))
    .withColumn("workflow_type", col("workflow_info.workflow_type.name"))
    .withColumn( "parent_workflow_id", col("workflow_info.parent_workflow_execution.workflow_id") )
    .withColumn( "parent_workflow_run_id", col("workflow_info.parent_workflow_execution.run_id") )
    # .withColumn("run_id", col("workflow_info.original_execution_run_id"))
    .withColumn("first_execution_run_id", col("workflow_info.first_execution_run_id"))
    .withColumn(
        "prev_execution_run_id",
        coalesce(
            first(
                col("workflow_task_failed_event_attributes.base_run_id"),
                ignorenulls=True,
            ).over(
                Window.partitionBy("shard_id", "tree_id", "branch_id").orderBy(
                    -col("txn_id")
                )
            ),
            col("workflow_info.continued_execution_run_id"),
        ),
    )
    .withColumn(
        "task_queue",
        coalesce(
            col("workflow_info.task_queue.normal_name"),
            col("workflow_info.task_queue.name"),
        ),
    )
    # Select all columns in the order we want to view them in
    .select(
        "workflow_id",
        "run_id",
        "workflow_type",
        "event_time",
        "event_type",
        "parent_workflow_id",
        "parent_workflow_run_id",
        "first_execution_run_id",
        "prev_execution_run_id",
        "task_queue",
        "event_id",
        "workflow_info",
        "workflow",
        "workflow_execution_started_event_attributes",
        "workflow_execution_completed_event_attributes",
        "workflow_execution_failed_event_attributes",
        "workflow_execution_timed_out_event_attributes",
        "workflow_task_scheduled_event_attributes",
        "workflow_task_started_event_attributes",
        "workflow_task_completed_event_attributes",
        "workflow_task_timed_out_event_attributes",
        "workflow_task_failed_event_attributes",
        "activity_task_scheduled_event_attributes",
        "activity_task_started_event_attributes",
        "activity_task_completed_event_attributes",
        "activity_task_failed_event_attributes",
        "activity_task_timed_out_event_attributes",
        "timer_started_event_attributes",
        "timer_fired_event_attributes",
        "activity_task_cancel_requested_event_attributes",
        "activity_task_canceled_event_attributes",
        "timer_canceled_event_attributes",
        "marker_recorded_event_attributes",
        "workflow_execution_signaled_event_attributes",
        "workflow_execution_terminated_event_attributes",
        "workflow_execution_cancel_requested_event_attributes",
        "workflow_execution_canceled_event_attributes",
        "request_cancel_external_workflow_execution_initiated_event_attributes",
        "request_cancel_external_workflow_execution_failed_event_attributes",
        "external_workflow_execution_cancel_requested_event_attributes",
        "workflow_execution_continued_as_new_event_attributes",
        "start_child_workflow_execution_initiated_event_attributes",
        "start_child_workflow_execution_failed_event_attributes",
        "child_workflow_execution_started_event_attributes",
        "child_workflow_execution_completed_event_attributes",
        "child_workflow_execution_failed_event_attributes",
        "child_workflow_execution_canceled_event_attributes",
        "child_workflow_execution_timed_out_event_attributes",
        "child_workflow_execution_terminated_event_attributes",
        "signal_external_workflow_execution_initiated_event_attributes",
        "signal_external_workflow_execution_failed_event_attributes",
        "external_workflow_execution_signaled_event_attributes",
        "upsert_workflow_search_attributes_event_attributes",
        "workflow_execution_update_accepted_event_attributes",
        "workflow_execution_update_rejected_event_attributes",
        "workflow_execution_update_completed_event_attributes",
        "workflow_properties_modified_externally_event_attributes",
        "activity_properties_modified_externally_event_attributes",
        "workflow_properties_modified_event_attributes",
        "shard_id",
        "tree_id",
        "branch_id",
        "node_id",
        "txn_id",
        # "prev_txn_id",
        "task_id",
        "version",
        "worker_may_ignore",
    )
)
```
