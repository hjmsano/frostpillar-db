# Frostpillar Vision and Principles

Status: Draft  
Last Updated: 2026-03-06

## 1. Purpose

The purpose of this project is to create an ultra-lightweight, purely TypeScript-based database engine tailored for handling up to 1GB of timeseries JSON data. While existing solutions like lowdb offer excellent developer experience and simplicity for small payloads, they struggle with large datasets because they serialize and rewrite the entire JSON object on every write.
This new database aims to bridge the gap between developer-friendly, zero-dependency Node.js/browser libraries and the high-performance demands of timeseries data. It will serve as an ideal database for edge computing, CI/CD pipelines, spot data analysis, and browser-based client applications.

## 2. Goals of the Development

Pure JavaScript/TypeScript: Run anywhere without requiring external runtimes, binaries, or complex compilation steps.
High Performance at Scale: Efficiently process large datasets (up to 1GB) by reading and writing only the necessary bytes, moving away from monolithic JSON.stringify dumps.
Environment Agnostic (Node.js & Browser): Provide seamless operation in both server environments (using disk I/O) and web browsers (using in-memory or browser storage APIs).
Built-in Data Lifecycle Management: Prevent out-of-memory or out-of-disk crashes by giving users strict control over maximum data size limitations, including automatic retention policies.

## 3. Detailed Specification Requirements

## 3.1. Storage Architecture & Encoding

To achieve the gigabyte scale efficiently, the engine will abandon plain text JSON arrays and utilize a structured binary storage format:

- Page-Based Organization: Data will be organized into fixed-size chunks or "pages" (e.g., 4KB, 8KB, or 16KB blocks), matching standard operating system buffered I/O concepts. Each page will use a slotted page structure featuring a page header, a cell pointer array, free space, and the actual items.
- TLV (Type-Length-Value) Binary Encoding: Instead of parsing JSON strings byte-by-byte, JSON objects will be stored using TLV. Each field is flagged with a data type, its exact byte length, and the value itself. This allows the engine to instantly skip over unnecessary records during a search, providing rapid row-by-row processing without wasting storage space.
- B+ Tree Indexing: To handle timeseries range queries efficiently, the engine will utilize a B+ tree structure. Routing nodes (which take up minimal space) will stay in memory, while leaf nodes sit at the bottom, forming a linked list of pages. Finding a timestamp takes O(log N) time, and fetching the subsequent timeseries logs requires a simple traversal of the linked list.

## 3.2. Execution Environments and I/O Strategy

To simplify the developer experience and avoid the complexity of lowdb's polymorphic adapter pattern—which requires users to instantiate separate classes or write custom adapter classes with read() and write() methods—the new engine will utilize a unified, configuration-driven architecture.
Furthermore, to maintain a lean codebase, the engine will be 100% Asynchronous. There will be no synchronous blocking modes (like lowdb's LowSync); users will simply use standard modern async/await to manage execution flow.

### A. Single Unified Datastore Class

Instead of importing specific adapters based on the environment, developers will instantiate a single Datastore class. The storage behavior is controlled entirely via a configuration object passed during initialization. This makes it trivial for a developer to switch between environments (e.g., swapping to memory for testing) by just changing a string in their config file.

### B. Storage Location Options

The Datastore config will accept a location parameter to dictate where the binary pages are routed:

- File: For Node.js/server environments. The engine uses native asynchronous file system APIs to read and write binary pages directly to a local disk.
- Memory: For high-speed temporary operations in Node.js or the browser. The entire B+ Tree and all TLV pages are held in standard JavaScript Uint8Array buffers.
- Browser: For client-side persistence. The engine maps its binary page storage to browser-native APIs like IndexedDB or Origin Private File System (OPFS), which are highly optimized for asynchronous binary data.
- Custom: Allows the user to provide a custom async callback or stream destination (e.g., piping data to an S3 bucket or a remote network storage).

### C. Write Frequency & Buffered I/O (Performance Optimization)

Because storage media operates on block-level constraints (typically 4KB to 16KB blocks), continuous disk I/O can severely bottleneck a timeseries database and degrade user experience. For example, standard lowdb warns of performance degradation when frequently calling db.write() on large datasets and recommends batching operations.
To solve this, the Datastore will feature a built-in Write Frequency Strategy, giving users granular control over when data is flushed from memory to the selected location:

- Immediate (frequency: "immediate", default): Every insert or update triggers an immediate asynchronous write to the destination. This provides the highest durability (similar to writing to a Write-Ahead Log to prevent data loss on crashes) but incurs the highest I/O cost.
- Interval / Time-Based (frequency: 5000): Data modifications are kept in an in-memory buffer. The Datastore automatically flushes the updated pages to the disk or browser storage every X milliseconds (e.g., every 5 seconds). This drastically reduces I/O bottlenecks during high-throughput timeseries ingestion.
- Size-Based Batching: The engine only flushes to the storage destination once the pending unwritten data reaches a certain size threshold (e.g., flush every 2MB of changes).
- Manual: Writes are entirely deferred until the developer explicitly calls an await db.commit() or await db.flush() function.

Because interval/size-based flushing runs in background tasks, the Datastore API must expose an explicit asynchronous error channel (for example `db.on("error", ...)`) so auto-commit/storage failures are never silent and can be wired to production monitoring.

## 3.3. Size Limitations and Retention Policies

Because this database is meant for spot analysis, CI/CD, and browsers where storage or memory is strictly finite, the engine will feature a Total Data Size Configurator (e.g., maxSize: '500MB').
When the size limit is breached, the database will handle it using one of two user-configured policies:

### Policy A: Strict Capacity (Stop and Alert)

- Behavior: The database instantly halts new insert() operations.
- Action: It throws a specific QuotaExceededError or alert back to the application layer.
- Use Case: Critical CI/CD data auditing where silently dropping logs is unacceptable, and the developer must be explicitly warned that the storage allocation was insufficient.

### Policy B: Turnover / Ring-Buffer (Delete Older Data)

- Behavior: The database automatically acts as a rolling buffer. When the capacity limit is reached, it begins dropping the oldest timeseries records (FIFO - First In, First Out) to free up space for incoming data.
- Action: Because the data is stored in a B+ Tree, the engine can efficiently drop the lowest-timestamp leaf pages and reallocate that free space to new pages.
- Use Case: Continuous monitoring, IoT telemetry, or browser-based logging, where having the most recent data is far more important than keeping historical logs.

## 3.4. Query Interfaces and Language Strategy

Frostpillar core MUST keep query execution in TypeScript-native operations and data structures.

- Native API: Frostpillar exposes native methods for range reads and record-level operations.
- External query languages: SQL subset and Lucene subset support are provided by optional query-engine modules.
- Query-engine modules parse language text and translate it into Frostpillar native query requests.
- Frostpillar core does not require users to select query language at datastore initialization.
- Full relational planning layers are intentionally excluded to keep implementation lightweight.
