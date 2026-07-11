---
title: "Building a Custom Vector Database - Part 1: Baseline Implementation"
date: "2026-07-08"
description: "An introduction to building a custom, high-performance vector database engine in C++ integrated with SQLite."
draft: false
series: building-vector-db
series_order: 1
width: "full"
githubRepo: "debug-cherry/tvDataBus"
githubReleases: "v0.1-baseline"
suggestedResources:
  - title: "Pinecone's Vector Database Overview"
    url: "https://www.pinecone.io/learn/vector-database/"
    description: "An excellent conceptual introduction to the architecture of vector databases."
  - title: "Milvus Documentation"
    url: "https://milvus.io/docs"
    description: "Detailed system architecture details of a production-grade distributed vector database."
---
The rapid adoption of machine learning has introduced a shift in how databases manage and query data. Traditional databases (relational or document-based) excel at exact matching—finding a row where `user_id = 42` or checking if a text field contains a specific keyword. However, modern machine learning applications deal with an ever-increasing amount of unstructured data: images, natural language, audio, etc. In these domains, exact matching fails and instead we must depend on similarity, or what is called **Semantic Similarity**.

For this, unstructured data is passed through deep learning models to generate vector embedding—numerical representations in a high-dimensional space where closeness in space corresponds to similarity in meaning.

> *A vector database is a storage and retrieval engine designed specifically to store these embedding and perform fast nearest-neighbor searches over millions of vectors in high-dimensional spaces*.

In this series, I will be learning and building a custom, high-performance vector database engine in C++ integrated with SQLite. Each part will deal with a specific feature or optimization and full length discussion on that (I really hope I can learn about it properly to hold a good discussion).


## The Basics of Vector Database

Let’s start with the basics of a *naive* vector database engine. At the bare minimum, such an engine must support the following operations:

1. Insert a fixed-dimensional vector of floating-point values into the database.
2. Perform an exact k-nearest neighbor search using L2 (Euclidean) distance metric.

Therefore, our first goal is to implement these core functionalities. Let's now discuss the implementation.

---

### Implementation

#### Inserting a fixed-dimensional vector of floating-point values

To store a vector in the database, we need to insert a vector of floating-point values (e.g., `[2.00, 9.87, 4.74, 6.147, 1.365, ...]`) along with a unique identifier assigned to that vector. Initially, the vector will be inserted into a local in-memory data structure, which will later be batch-written to the underlying database.

For our current implementation, the underlying database engine is SQLite, and the batch insertion into SQLite will be handled through its C API. Therefore, our focus here will be on implementing insertion and nearest-neighbor search operations on the local in-memory data structure.

Each entry in our in-memory database consists of:

* A unique integer identifier
* A fixed-length vector of floating-point values (the embedding)

The first representation that comes to mind is a structure containing these two components:

```cpp
// Conceptual Representation of an entry
struct DbEntry 
{
	int64_t id_;
    // int64_t is a fixed-width signed integer type 
    // which is guaranteed to be exactly 64 bits wide 

	std::vector<float> vector_;
};

// The Database itself
std::vector<DbEntry> database_;
```

This representation is intuitive because it models the data exactly as we describe it: a collection of entries, where each entry consists of an identifier and its associated vector.

---

However, this simplicity comes with a trade-off that becomes significant when considering cache behavior and memory bandwidth utilization. During a similarity search, the access pattern typically looks as follows:

1. Iterate over the array of `DbEntry` objects.
2. Load each `DbEntry` into the cache.
3. Access the `std::vector<float>` object stored inside the structure.
4. Follow the pointer to the actual embedding data stored elsewhere in memory.
5. Compute the similarity between the stored embedding and the query vector.
6. Store the resulting `(id, distance)` pair for subsequent top-K selection.
7. Repeat the process for the next entry.

This layout is known as an **Array of Structures (AoS)**. It is highly intuitive and aligns well with object-oriented design principles. However, for data-intensive workloads such as vector similarity search, it has several disadvantages:

* Unnecessary data (such as identifiers) may be loaded into the cache during search.
* Higher memory bandwidth is required.
* Cache utilization efficiency decreases.

So we will move to another representation of the same data which is known as **Structure of Array (SoA)**. In our case, the SoA representation would look like:

```cpp
// SoA Representation of a database entry
class Database:
private: 
	std::vector<int64_t> ids_;
	std::vector<std::vector<float>> vectors_;
```

Here, the vector embedding and its assigned identifier are pushed together to the both vectors. So they maintain the same index in their respective arrays. For this case when we are searching for a vector embedding, the procedure would look like:

1. Iterate over the array of pointers to array which stored the embedding vector.
2. Load up the embedding vector only.
3. Compute its distance to the query vector.
4. Retrieve the corresponding identifier using the same array index.
5. Create an `(id, distance)` pair and store it separately for top-K searching.
6. Move on to the next float array pointer.

Although the CPU still performs pointer dereferences because each embedding is stored in a separate `std::vector<float>`, the search procedure avoids loading unrelated data such as identifiers during the computation phase. Consequently, this representation reduces memory bandwidth requirements and improves cache utilization.

*\[Note: This representation is partially SoA because the embedding vectors themselves remain separately allocated objects. A fully contiguous SoA representation would store all embedding values in a single contiguous array, eliminating most pointer dereferences and improving cache efficiency.\]*

---

We did mention before that the vector arrays must be of *fixed-length*. So we need to add another parameter which stores the fixed-dimension for the vectors. Therefore the final data structure representation becomes:

```cpp
// Final Representation of the database
class Database {
private:
	size_t dimensions_;
	// Used to store the dimensionality of vectors.
    // size_t is an unsigned integer type 
    // intended for sizes and counts.

	std::vector<int64_t> ids_;
	std::vector<std::vector<float>> vectors_;
};
```

---

#### Performing Exact K-Nearest Neighbor Search and return top-K results

The data structures described above allow us to store vectors together with their corresponding identifiers. The next step is to design a search algorithm that can find the vectors most similar to a given query vector. However, we must first understand what it means to compare two vectors.

A vector can be viewed as a point in an N-dimensional space. When using the L2 (Euclidean) distance, comparing two vectors means computing the Euclidean distance between them. The smaller the distance between two vectors, the more similar they are considered to be.

For example, we have the following five three-dimensional vectors:

$$
\text{B} = \begin{bmatrix} -3.4 \\ 0.95 \\ 1.31 \end{bmatrix}\quad \text{C} = \begin{bmatrix} -1.89 \\ 1.87 \\ 5.67 \end{bmatrix}

$$

$$
\text{D} = \begin{bmatrix} 2.44 \\ 2.18 \\ 1.67 \end{bmatrix}\quad \text{E} = \begin{bmatrix} 1.3 \\ -2.47 \\ 6.56 \end{bmatrix}\quad \text{F} = \begin{bmatrix} -2.4 \\ -2.79 \\ 2 \end{bmatrix}

$$

and given a following query vector

$$
\text{A} = \begin{bmatrix} -1.63 \\ 1.07 \\ 4 \end{bmatrix}

$$

We need to calculate the distance between vector A and other vectors. These distance is calculated using L2 distance formulas:

For two n-dimensional vectors

$$
\mathbf{x} = \begin{pmatrix} x_1, x_2,...,x_n\end{pmatrix}\qquad \mathbf{y} = \begin{pmatrix} y_1, y_2,...,y_n\end{pmatrix}

$$

the **L2 (Euclidean) distance** is written as

$$
d(\mathbf{x}, \mathbf{y}) = \left( \sum_{i=1}^{n} (x_i - y_i)^2)\right)^{1/2}

$$

In practice, however, we often compute the squared L2 distance instead of the actual Euclidean distance. Since the square root function is monotonic, omitting it preserves the relative ordering of distances while avoiding an expensive operation.

---

A straightforward C++ implementation looks like this:

```cpp
float calculate_l2_distance(const std::vector<float>& a,
                            const std::vector<float>& b) {
    float sum = 0.0f;
    for (size_t i = 0; i < dimensions_; i++) {
        float diff = a[i] - b[i]
        sum += diff * diff;
    }
    return sum;
}
```

If we calculate the distances between vector A and other vectors, we would get the following results:

```plaintext
--- Distances in squared units ---
A - B: 10.37841
A - C: 3.53383
A - D: 23.27749
A - E: 27.50779
A - F: 19.31547
```

Now we need the **top-K** vectors using these distances. We will sort the distances in ascending order which results in the **top-3** vectors being:

$$
C = 3.53383\quad B = 10.37841\quad F = 19.31547

$$

Therefore, the search operation returns the identifiers associated with vectors **B**, **C** and **F**.

Therefore the algorithm for calculating and returning the **top-K** results can be described in the following steps:

1. Iterate through all stored vectors.
2. Compute the squared L2 distance between the query vector and the current vector.
3. Retrieve the corresponding vector identifier and store the `(id, distance)` pair for later use.
4. After processing all vectors, sort the results by distance.
5. Return these top-K `(id, distance)` pairs.

The data structure for storing the `(id, distance)` pair could be stored in several ways. Some common ways would be:

```cpp
std::vector<std::pair<int, float>> results;
```

or

```cpp
struct SearchResult 
{
    int64_t id;
    float distance:
};
std::vector<SearchResult> results;
```

---

A small optimization at this stage is to reserve memory for the search results before beginning the search. Since the database is not modified during a query, we know the exact number of results that will be generated.

```cpp
results.reserve(vectors_.size());
```

This eliminates repeated memory reallocations as the result vector grows, reducing allocation overhead during the search process.

---

---

## SQLite API Configuration

This section is somewhat more involved than the previous ones because we need to integrate our vector database with SQLite's **Virtual Table API**. The Virtual Table API primarily consists of a collection of callback functions that allow SQLite to interact with external storage engines through a standardized interface. Do not worry if some of the implementation details seem unfamiliar at first. The goal here is to understand the overall structure rather than memorize every callback function.

This article will provide only a high-level overview of the virtual table architecture. If you have not worked with the SQLite C API before, I recommend first reading the following documentation:

* **The Virtual Table Mechanism of SQLite**
  [https://www.sqlite.org/vtab.html](https://www.sqlite.org/vtab.html)
* The source code accompanying this series
* SQLite's own example virtual table implementations

The first thing to understand is that SQLite interacts with our extension through a set of callback functions. Whenever a user executes a query, SQLite invokes these callbacks to create tables, perform searches, retrieve rows and clean up resources.

From the SQLite Documentation:

> The virtual table mechanism allows an application to publish interfaces that are accessible from SQL statements as if they were tables. SQL statements can do almost anything to a virtual table that they can do to a real table.

---

To handle these interactions, we define two structures:

**The table object**

```cpp
struct VectorVTab {
    sqlite_vtab base;
    std::unique_ptr<VectorEngine> engine;
};
```

**The cursor object**

```cpp
struct VectorCursor {
    sqlite_vtab_cursor base;
    std::vector<SearchResult> results;
    size_t current_idx;
}
```

The `VectorVTab` structure represents our virtual table. Besides the required `sqlite_vtab` base structure, it contains an instance of our `VectorEngine`, which stores vectors and performs nearest neighbor searches.

The `VectorCursor` structure represents an active search operation. Whenever SQLite executes a query against our virtual table, it creates a cursor object that store the search results tracks the current position while SQLite iterates through them.

At a high level, the execution flow looks like this:

1. SQLite creates an instance of our virtual table.
2. SQLite asks our extension whether it can optimize a given query.
3. Our extension performs the vector search.
4. The search results are stored in the cursor.
5. SQLite iterates through the results one row at a time.

---

Our database is represented in the following SQL format:

```sql
CREATE TABLE x(
    id INTEGER,
    distance REAL,
    query_vector BLOB HIDDEN,
    k INTEGER HIDDEN
);
```

---

**Why the columns** `query_vector` **and** `k` **are HIDDEN?** SQL Interface doesn't provide a native method calling process which is expected for the searching like `search(query_vector, k)`. Thus virtual table API allows us to define hidden columns which can behave like function parameters:

* It can be used in the `WHERE` clause,
* It is passed to our virtual table implementation,
* It doesn't appear in the normal query results.

For example, we can write:

```sql
SELECT id, distance
FROM x
WHERE query_vector = ?
  AND k = 10;
```

This is an SQL representation of the function `engine.search(query_vector, k)`

We cannot make these into normal colunms because neither `query_vector` nor `k` is stored data and they exist only for the duration of search results.

---

The callback functions we have implemented are:

* `xConnect()`
* `xDisconnect()`
* `xOpen()`
* `xClose()`
* `xBestIndex()`
* `xFilter()`
* `xNext()`
* `xEof()`
* `xColumn()`
* `xRowid()`

These implementations are mostly template functions except `xBestIndex()` which is designed for query planning and `xFilter()` which is designed for query execution according to our engine. Refer to the source code on GitHub for implementation details.

---

---

## Benchmarking and Profiling

The engine we have discussed right now is our baseline. It's the time to benchmark it to find exactly what numbers we are dealing with. We will be benchmarking two different systems right now.

1. The raw `VectorEngine` implementation.
2. The same `VectorEngine` exposed through SQLite's Virtual Table API.

The purpose of benchmarking the raw VectorEngine is to measure the intrinsic performance of our search implementation without any external framework overhead. This provides us with a lower bound on the execution time of our current design.

The second benchmark measures the performance of the same search engine when accessed through SQLite's Virtual Table Interface. Since the underlying search algorithm remains identical, any difference in execution time can be largely attributed to the overhead introduced by SQLite's virtualization layer, including:

* query planning
* virtual table callback dispatch
* cursor management
* row materialization

Conceptually the two execution paths can be represented as:

Raw Engine Benchmark

1. Application
2. `VectorEngine::search()`
3. Search Results

SQLite Virtual Table Benchmark

1. Application
2. SQLite Parser
3. Query Planner
4. Virtual Table API
5. VectorEngine::search()
6. Cursor Materialization
7. Search Results

By comparing these two measurements, we can answer an important question:
**How much performance do we lose by exposing our vector engine through SQLite's Virtual Table abstraction?**

This benchmark will serve as the reference point for all our subsequestion optimizations introduced throughout the subsequent articles in this series.

To execute the benchmark, we execute the following commands:

```bash
# Run from project root
# Build the project
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
cmake --build build-release

# To run
# Prevent CPU frequency scaling from affecting measurements 
sudo cpupower frequency-set -g performance

# Pinning to CPU Core 2 for execution avoids scheduler migration
taskset -c 2 ./build-release/benchmark_driver 
```

Our current benchmark results stand at (the values are in CPU cycles):

```plaintext
=== VectorEngine (Direct Call - Search Space: 10,000 vectors) (Cycles) ===
  Min:    1116770
  P50:    1216620
  P95:    2643618
  Max:    3415592
  Average:1403300

=== SQLite Virtual Table (Via Virtual Interface - Search Space: 10,000 vectors) (Cycles) ===
  Min:    1142660
  P50:    1350290
  P95:    2464694
  Max:    3251712
  Average:1498781
```

The benchmark results show that executing search through SQLite's Cirtual Table interface requires an addtional **95,481 CPU cycles** compared to invoking the `VectorEngine` directly.

Relative to the raw execution time, this corresponds to an overhead of Overhead=1498781−14033001403300×100≈6.80

In other words, exposing the search engine through SQLite's virtualization layer increases the execution time by only 6.8%. Since the overhead is relatively small, it is unlikely to be the primary performance bottleneck. Instead, most of the execution time is spent inside the search engine itself.

To identify where that time is being spent, we now turn to profiling.

Unlike benchmarking, which tells us how fast the program executes, profiling tells us where the CPU spends its time. For this purpose, we will use Linux's perf profiler to sample the executing program and identify the functions responsible for the majority of the CPU cycles. This information will guide the optimization process for the remainder of this series.

To run profiling, we must have priviledged access:

```bash
# Build
cmake -S . -B build-perf -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_CXX_FLAGS="-O3 -g -fno-omit-frame-pointer"
cmake --build build-perf

# Run the executable

# Prevent CPU frequency scaling from affecting measurements
sudo cpupower frequency-set -g performance

# Allow perf to collect profiling data
sudo sysctl -w kernel.perf_event_paranoid=-1

# Allow symbol resolution inside the Linux kernel
# (Not recommended on systems exposed to untrusted users or networks)
sudo sysctl -w kernel.kptr_restrict=0

taskset -c 2 perf record -F 10000 -g -- ./build-perf/benchmark_driver
```

After the benchmark finishes, open the collected profile using:

```bash
perf report
```

This launches an interactive interface displaying the functions responsible for the majority of the sampled CPU cycles. The list is sorted by Overhead, which represents the percentage of samples attributed to each function. Functions near the top of the report are the primary performance hotspots and therefore the best candidates for optimization.

Following is a screenshot from the `perf` report.

![A snippet from the perf report](https://cdn.hashnode.com/uploads/covers/6a48e22463fb28726f9e72a0/951832b2-bb34-4f7d-b982-52980e73797c.png align="center")

For our analysis, we are primarily interested in two columns:

* **Self** - the percentage of CPU samples spent executing the function itself, excluding the time spent in any functions it calls.
* **Symbol** - the name of the function to which the sampled CPU cycles were attributed.

Examining the report, we observe that the function

```plaintext
VectorEngine::calculate_l2_distance(
    const std::vector<float>&,
    const std::vector<float>&
) const
```

accounts for **77.64%** of the sampled CPU cycles. In other words, nearly four-fifths of the execution time is spent computing the squared L2 distance between vectors.

The next article begins exactly here. We will progressively optimize the calculate\_l2\_distance() function, measuring the performance improvement after each optimization and quantifying its impact on the overall search latency.

---

---

This marks the end of our baseline implementation. Every optimization introduced in the remainder of this series will be motivated by these profiling results and validated through benchmarking. In the next article, we will begin with the most obvious target, optimizing the L2 distance computation, and measure exactly how much performance we can extract.
