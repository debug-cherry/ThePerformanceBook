---
title: "Designing for Cache Locality: AoS, SoA, and the Overhead of Heap Allocations"
date: "2026-07-13"
description: "A quick byte into how CPU cache lines, memory alignment, and heap allocation overhead affect the performance of high-dimensional vector search."
draft: false
series: building-vector-db
series_order: 2
quickByte: true
width: "full"
suggestedResources:
  - title: "What Every Programmer Should Know About Memory"
    url: "https://people.freebsd.org/~lstewart/articles/cpumemory.pdf"
    description: "Ulrich Drepper's classic paper on memory subsystem mechanics and cache design."
  - title: "Data-Oriented Design"
    url: "https://www.dataorienteddesign.com/dodbook/"
    description: "A comprehensive resource on designing programs around data access patterns and memory layouts."
---

When developing high-performance applications, we often focus on algorithmic complexity. However, on modern hardware, execution time is frequently dictated by memory latency rather than raw CPU instruction count. A CPU can execute multiple arithmetic instructions in a single nanosecond, but retrieving a value from main memory (DRAM) can take up to **100 nanoseconds**.

In vector databases, where similarity search requires scanning millions of dimensions, memory bandwidth is almost always the primary bottleneck. To design an efficient search engine, we must align our data structures with the physical reality of the CPU cache hierarchy.

In this article, we examine how the choice between **Array of Structures (AoS)** and **Structure of Arrays (SoA)** impacts cache locality, and explore the significant performance penalties associated with nested heap allocations.

## Understanding CPU Cache Lines

When the CPU requests a single byte of memory, the system does not fetch only that byte. Instead, it retrieves a contiguous block of memory called a **cache line**—typically 64 bytes on modern x86 and ARM architectures—and loads it into the L1 cache.

```plaintext
Memory Access (64-byte Cache Line)
+---------------------------------------------------------------+
| Byte 0 | Byte 1 | Byte 2 | ...                      | Byte 63 |
+---------------------------------------------------------------+
[Requested Byte]  [Automatically loaded adjacent bytes]
```

This behavior leverages two fundamental principles of data access:
* **Spatial Locality:** If a memory location is accessed, nearby memory locations are highly likely to be accessed soon after.
* **Temporal Locality:** If a memory location is accessed, the same location is likely to be accessed again in the near future.

In a dense loop like an $L_2$ distance calculation, we want every byte loaded into a cache line to be used in immediate computations. Loading data that is never read by the loop is called **cache pollution**, which wastes valuable memory bandwidth.

## Memory Layouts: AoS vs. SoA

The way we structure our database entities in memory directly dictates how efficiently the CPU can populate its cache lines during search.

### Array of Structures (AoS)

The standard object-oriented approach groups related attributes together in a single structure or class:

```cpp
struct DbEntry {
    int64_t id;             // 8 bytes
    std::vector<float> vec; // 24 bytes (pointer + size + capacity)
};
std::vector<DbEntry> database;
```

In memory, this layout places each `DbEntry` contiguous to the next:

```plaintext
AoS Memory Layout:
+-------------------+-------------------+-------------------+
|  DbEntry 0        |  DbEntry 1        |  DbEntry 2        |
|  [ID] [VectorPtr] |  [ID] [VectorPtr] |  [ID] [VectorPtr] |
+-------------------+-------------------+-------------------+
```

When iterating through this database to compute vector distances, the CPU loads a cache line containing the current `DbEntry`. However, during the distance computation, the `id` field is not required. Loading it into the cache line displaces useful data, resulting in inefficient bandwidth utilization. Furthermore, the actual float values reside at a different heap location pointed to by `vec`, adding an extra step of pointer indirection.

### Structure of Arrays (SoA)

The data-oriented approach separates these fields into independent parallel arrays:

```cpp
class Database {
    std::vector<int64_t> ids;
    std::vector<std::vector<float>> vectors;
};
```

This rearranges the data sequentially by field:

```plaintext
SoA Memory Layout:
IDs:     [ID 0] [ID 1] [ID 2] ...
Vectors: [VecPtr 0] [VecPtr 1] [VecPtr 2] ...
```

During a query, we iterate strictly through the `vectors` array to calculate distances. The `ids` array is never touched during the core computation loop, keeping the CPU cache focused on the search coordinates. Once we identify the indices of the closest vectors, we look up their corresponding identifiers in the `ids` array.

## The Hidden Costs of Nested Heap Allocations

While our initial SoA implementation separates metadata from vector references, it still suffers from a major performance bottleneck: **pointer chasing** and **allocation overhead** due to nested heap allocations.

```cpp
std::vector<std::vector<float>> vectors;
```

In standard C++ implementations, a `std::vector` contains three pointers (typically 24 bytes of memory): a pointer to the start of the allocated heap memory, a pointer to the end of the used memory, and a pointer to the end of the capacity. This creates a nested structure where the outer container holds descriptors, and the actual payload is scattered across the heap.

```plaintext
Nested Allocations Memory Map:
Outer Vector: [ VecPtr 0 ] ---> Heap Allocation 0: [ x0, y0, z0 ... ]
              [ VecPtr 1 ] ---> Heap Allocation 1: [ x1, y1, z1 ... ]
              [ VecPtr 2 ] ---> Heap Allocation 2: [ x2, y2, z2 ... ]
```

This layout introduces three main performance penalties:

### 1. Pointer Indirection (Pointer Chasing)
To read a float from `vectors[i][j]`, the CPU must first load the address of `vectors[i]` to read its internal pointer, and then perform a second memory request to fetch the actual vector contents at that address. This second access cannot begin until the first has finished, creating a dependency chain that stalls the CPU pipeline.

### 2. Allocator Metadata Overhead
Every time memory is allocated on the heap (e.g., via `std::malloc` or `new`), the system allocator incurs overhead. 
* **Header Overhead:** The heap allocator typically prepends a small header (often 8 to 16 bytes) to each allocation to track the block size and status. If we store millions of small vectors, this header overhead can consume significant memory.
* **Internal Fragmentation:** Memory allocators often round allocation sizes to the nearest 8-byte or 16-byte boundary. A vector with a non-standard length may end up wasting padding bytes at the end of each block.

### 3. Loss of Hardware Prefetching
Modern CPUs feature **hardware prefetchers** that analyze memory access patterns. If they detect a sequential read (e.g., accessing addresses $N, N+4, N+8$), they will pre-emptively load subsequent cache lines from DRAM into the L1/L2 cache before the CPU explicitly requests them.

When vectors are allocated independently on the heap, their addresses are determined by the allocator and are rarely contiguous. The prefetcher cannot predict the next target address, forcing the CPU to stall frequently while waiting for random heap accesses to resolve.

## Transitioning to a Flat Contiguous Layout

To eliminate pointer indirection and allocation overhead, we can flatten our data representation. Instead of an array of dynamically allocated vectors, we can store all vector elements in a single, contiguous array.

```cpp
class FlatDatabase {
private:
    size_t dimensions_;
    std::vector<int64_t> ids_;
    std::vector<float> flat_vectors_; // All dimensions stored contiguously
};
```

In this flattened layout, the elements of vector $i$ start at index `i * dimensions_` and end at `(i + 1) * dimensions_`:

```plaintext
Flat Contiguous Memory Layout:
flat_vectors_: [ v0_x, v0_y, v0_z, v1_x, v1_y, v1_z, v2_x, v2_y, v2_z ... ]
```

This design yields several advantages:
1. **Single Allocation:** All vector coordinates in the database are stored in one block of memory, reducing heap allocator overhead and fragmentation to a negligible level.
2. **Zero Pointer Indirection:** The CPU reads vector values directly from the main array without traversing an intermediate pointer.
3. **Prefetcher Friendly:** Because the memory layout is strictly sequential and contiguous, the hardware prefetcher can reliably predict and load adjacent vector coordinates well in advance of the calculation.

## Conclusion

Maximizing the throughput of a vector database requires aligning memory layouts with CPU cache architectures. Transitioning from an Array of Structures (AoS) to a Structure of Arrays (SoA) layout prevents cache pollution by isolating search-critical dimensions from query metadata. 

By taking this a step further and flattening nested arrays into a single contiguous block of memory, we eliminate the latency of pointer chasing and minimize heap allocator overhead. 

In the next part of this series, we will combine this contiguous memory layout with **SIMD (Single Instruction, Multiple Data)** operations to accelerate our distance calculations.