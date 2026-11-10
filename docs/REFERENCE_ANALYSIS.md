# Learning from Zero-Mem

This analysis supports an independent TypeScript library, not a mechanical port.
The aim is useful, measurable memory retrieval with a small operational footprint.
Only the one-mem package bootstrap currently exists; recommendations below are not implemented features.

## Evidence and scope

- Reference: [Zero-Mem/Zero-mem](https://github.com/Zero-Mem/Zero-mem), inspected at `e1b2f8ef98a3d023478ddb2049aba11753296d42` on 2026-11-10.
- Paper: [Zero-Mem: Zero-Token Memory Operations for LLM Agents](https://arxiv.org/abs/2607.29377), Yilin Xiao et al., submitted 2026-07-31.
- Source findings below come from CodeGraph inspection of the checked-out implementation, including orchestration, configuration, indexing, retrieval, reader, and persistence.
- The reference checkout was read only. No code, prompts, model weights, or datasets are copied into one-mem.
- No upstream license file was found in the inspected tracked files. A public repository is not itself a license to redistribute its material.
- Paper results are the authors' measurements. This analysis does not reproduce them or establish one-mem accuracy, speed, or algorithmic equivalence.

**Observed** describes that revision. **Recommended** describes one-mem's proposed design.
The executable plan is [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); current project decisions remain in [DECISIONS.md](DECISIONS.md).

## What the reference actually does

### Orchestration and model boundaries

**Observed.** [`ZeroMem`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/ZeroMem.py#L22) composes indexing, query analysis, retrieval, evidence, reader, answer calibration, and answer extraction mixins.
Most modules communicate through mutable state on the same instance: embeddings, entity/sentence maps, graph vertex maps, hierarchy units, lexical postings, rerankers, and caches.
This is an integrated research runtime rather than a set of independently specified storage and provider interfaces.

[`run.py`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/run.py#L442) loads a dataset and models, creates configuration, indexes the corpus, runs graph/hierarchy/fusion modes, then exports predictions and provenance.
[`generate_answers_for_mode`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/run.py#L284) separates retrieval failures from QA failures and batches retrieval before concurrent reader calls.
It exports predictions; benchmark scoring is a separate concern.

The embedding interface is a SentenceTransformer-like object with `encode(...)`, not the string suggested by its configuration annotation.
[`load_embedding_model`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/run.py#L260) explicitly moves the model to CPU or CUDA and verifies CUDA placement.
[`_encode_embeddings`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/ZeroMem.py#L132) requests normalized embeddings.
spaCy provides entity and linguistic analysis; optional cross-encoders provide reranking.
These are model inference costs even though they are not generative memory operations.

[`ZeroMemReaderClient`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/utils.py#L54) wraps an OpenAI-compatible chat endpoint for final QA.
It records requested/reported model identities, usage, request IDs, elapsed time, HTTP attempts, and observed retries.
One logical reader invocation can produce multiple HTTP attempts because the SDK permits retries.
“Zero-token memory” therefore does not mean zero inference, free embeddings, or zero final-answer tokens.

**Recommended.** Retain the separation between memory retrieval and optional answer generation.
Use ordinary functions and a small storage owner rather than a mixin graph.
Require a caller-supplied embedding provider initially; do not silently select, download, or call a model.
Keep the final reader outside the required memory API.

### Indexing and persistence

**Observed.** [`index`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L417) performs these stages:

1. Check the corpus isolation manifest and populate passage embeddings.
2. Extract passage metadata and build BM25 postings.
3. Reuse or compute spaCy NER results.
4. Build entity/sentence incidence maps.
5. Optionally build hierarchy structures and density profiles.
6. Embed sentences and entities.
7. Build entity–passage and adjacent-passage edges; write GraphML and metadata.
8. Refresh in-memory matrices and vertex mappings for retrieval.

[`EmbeddingStore`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/embedding_store.py#L23) loads whole Parquet columns into Python lists and dictionaries.
IDs are namespaced hashes of text; only missing text IDs are embedded, and saving rewrites the store.
Graph data is GraphML; NER, hierarchy metadata, and isolation state are JSON files.
The inspected storage path does not provide a transactional commit spanning all these files.

[`IsolationGuard.ensure_corpus_cache`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L234) checks the corpus fingerprint and stale IDs.
A changed corpus or incompatible cache can reset the cache before rebuilding.
[`write_manifest`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L258) records corpus/dataset/boundary counts, not a complete embedding-space contract.
This cache workflow is useful for benchmark isolation, but is not a ready-made incremental update/delete API.

[`load_dataset`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/data_io.py#L409) handles document chunks or formatted conversation sessions.
Metadata is often embedded into passage text and recovered with parsers.
Distinct source records can therefore depend on their formatting for identity and provenance.

**Recommended.** Store caller IDs and explicit source/session metadata in SQLite.
Keep original text authoritative; preserve identical text from different sources as separate records.
Put each record's text, vector, revision, and FTS updates in one transaction.
Use one namespace and one embedding space per database initially: this makes isolation, FTS statistics, and upgrade rules straightforward.
Separate databases are an explicit storage boundary, not an authentication system.
Do not introduce a cache-generation framework for indexes that SQL can maintain transactionally.

### Entity graph retrieval

**Observed.** The graph combines passage and entity vertices.
Sentences are embedded and used as an incidence structure for activation; they are not simply a third set of graph vertices in personalized PageRank.
[`extract_nodes_and_edges`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L582) creates entity↔sentence maps.
[`add_entity_to_passage_edges`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L552) weights entity–passage links by substring occurrence counts relative to a passage's total entity occurrences.
[`add_adjacent_passage_edges`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L502) connects consecutive globally numbered passages inferred from text prefixes.

[`get_seed_entities`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L573) extracts query entities, embeds them, and selects the most similar stored entity for each.
The shown selection has no minimum semantic-match threshold: the nearest entity need not be a good entity match.
[`graph_search_with_seed_entities`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L256) combines entity activation and passage weights before personalized PageRank.
[`calculate_passage_scores`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L545) mixes normalized dense scores with a logarithmic entity-occurrence bonus and a passage-node multiplier.
[`dense_passage_retrieval`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L566) computes all passage dot products, then sorts them.

The graph is consequently more specific than generic “graph RAG”: it is query-dependent entity activation followed by passage/entity PageRank, with additional lexical and query-specific handling around it.
Entity co-occurrence here is evidence connectivity, not a verified knowledge-graph relation such as “works at”.
The [BFS and vectorized activation paths](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L288) differ in sentence consumption, threshold handling, path accumulation, and tier bookkeeping.
BFS consumes shared sentences as entities are processed and retains the last path/tier for a passage bonus; vectorized propagation aggregates through sentences and can accumulate below-threshold contributions.
Treat them as different algorithms; a faster path cannot be assumed to preserve rankings.

**Recommended.** First establish a dense + lexical baseline.
An entity graph introduces extraction models, canonicalization, mention provenance, sentence embeddings, graph maintenance, and extra tuning.
Add it only when held-out failures show that relation traversal improves evidence recall beyond hybrid search and local context.
Any experiment must use explicit source/session boundaries, deterministic ties, seed rejection thresholds, and attributed edges.
Never copy global numeric adjacency as a memory relation.

### Temporal hierarchy

**Observed.** [`_split_text_into_turns`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L755) recognizes document markers, dialogue IDs, speakers, line breaks, and punctuation.
Fallback parsing merges some short fragments; this is a heuristic, not a language-independent turn parser.
Document “turns” can prepend the title to each sentence.

[`_build_hierarchy_structures`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L1082) creates a forward window starting at every turn.
The default width is three, and trailing windows may contain only one or two turns.
[`_build_local_trigram_structures`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L888) separately creates exactly three adjacent turns; “trigram” here means turns, not words or characters.
Trigrams retain source IDs and a center turn, and have their own embeddings.

[`_build_episode_units`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L1037) greedily groups ordered windows.
The default gates are embedding dot product ≥ 0.72 or keyword Jaccard ≥ 0.18, with at most four windows per episode.
Sample/session/document compatibility also gates merging; an unknown sample can match a known sample in this construction.
Its updated centroid is an arithmetic mean without explicit renormalization, so its dot product is not automatically cosine similarity.
Overlapping window text can repeat within an episode.

Hierarchy retrieval scores episodes, windows, turns, and local trigrams, with semantic, lexical, phrase, subject, event, and temporal signals.
It is not solely a tree walk or a nearest-neighbor lookup.
Additional gates, penalties, completion, and reranking affect the final evidence.

**Recommended.** Accept real turns with explicit source, session, order, and time metadata.
Retrieve a matching record, then fetch a small number of adjacent records from that exact source/session.
This supplies conversational context without maintaining overlapping embeddings or repairing text-derived IDs.
Keep session order separate from event time: a statement recorded today can discuss an earlier event.
Only evaluate stored windows/episodes if neighbor expansion demonstrably misses necessary nonlocal context.

### Density routing, query analysis, and evidence

**Observed.** [`_build_density_profiles`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/indexing.py#L365) combines normalized entity density, entity-bearing sentence ratio, and keyword density.
Low-ratio penalties and force-graph/force-hierarchy thresholds can override the simple score threshold.
These are hand-tuned routing features, not learned guarantees about retrieval quality.
At the inspected revision, density buckets constrain the final hierarchy passage aggregation; they do not partition graph indexing or the entire hierarchy turn candidate pool ([aggregation](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/retrieval.py#L1872)).

[`ZeroMemConfig`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/config.py#L5) exposes many interacting weights and gates.
Examples include graph BM25 bonuses, hierarchy subject/event signals, trigram penalties, cluster caps, support completion, and reader calibration.
Defaults prioritize hierarchy for explicit temporal structure; plural wording or a missing subject alone do not enable hierarchy routing by default.
The CLI also overrides some dataclass defaults: sentence top-k, passage ratio, and activation threshold differ ([CLI](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/run.py#L61)). A reproducible experiment needs the resolved configuration, not just default class values.

[`SpacyNER.question_analysis`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/ner.py#L71) uses English linguistic cues, including grammatical number for “what/which” targets.
Ordinal and cardinal named entities are excluded from the reference's NER output.
[`QueryMixin`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/query.py#L8) adds question-type, subject, time, event, and lexical heuristics.
These choices need independent evaluation for technical identifiers, numeric facts, and Vietnamese text.

Evidence processing deduplicates, selects, expands, and formats source-bearing units before final QA.
It can complete support beyond the initial branch candidates; evaluating only an early top-k would not describe all evidence available to the reader.
[`_format_hierarchy_turn_for_reader`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/evidence.py#L1040) carries dialogue source, time, speaker, and sample metadata forward.
The configuration's `reader_prompt_token_budget` is explicitly a **whitespace-word budget**, despite its legacy name, not a tokenizer or API-token guarantee.
[Reader budgeting](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/reader.py#L325) reserves at least 256 evidence words even when a smaller configured cap would suggest less, and can truncate inside evidence text.
The [reader path](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/reader.py#L1006) makes a logical final call with deterministic postprocessing, not a second generative verification stage.

**Recommended.** Fuse dense and lexical **ranks**, using reciprocal rank fusion, before adding task-specific weights.
Use explicit source/session filters before candidate top-k; do not infer isolation from question text.
Keep budgets literal: initially UTF-8 evidence-text bytes, later reader-specific input tokens only if a real tokenizer/provider counter is supplied.
Return source records and revisions so retrieval can be audited without invoking a reader.
Treat all numerical reference thresholds as experimental starting points, not TypeScript defaults.

## Recommended choices and alternatives

| Decision | Recommendation | Alternative and when it wins |
| --- | --- | --- |
| Package shape | One strict TypeScript ESM library | CLI/server only after a concrete caller requires them |
| SQLite driver | One `better-sqlite3` adapter; locally verified under Node and Bun | Dual drivers if shared-driver compatibility fails elsewhere or measured Bun benefits justify extra maintenance |
| Vector storage | Normal SQLite BLOBs and sqlite-vec cosine-distance functions | Move vectors into `vec0` when measured corpus-size/latency needs justify synchronizing a separate vector table |
| Lexical retrieval | SQLite FTS5 with safely compiled terms | Custom BM25 only if FTS tokenization fails measured domain/language requirements |
| Ranking | Dense + lexical reciprocal rank fusion | Learned or cross-encoder reranking after a fixed-budget evaluation shows a useful gain |
| Identity | Caller ID inside one explicit database namespace | Content hashes for optional computation caches, never source-record identity |
| Model integration | Caller-supplied embedding function with a persisted space ID | Built-in local model for offline convenience; built-in remote client for managed deployment, after requirements are known |
| Conversation context | Explicit source/session/order; fetch neighbors | Persisted windows/episodes when nonlocal context benchmarks justify their cost |
| Graph | Optional experiment, not an initial dependency | Promote only after hybrid/context baseline failure analysis and a held-out recall gain |
| QA | Caller consumes evidence; optional reader later | Provider SDK only when the project actually owns final-answer generation |

The shared driver and ordinary vector rows minimize runtime-specific code and update/delete failure modes.
They are recommendations, not claims that one option is fastest.
SQLite-vec scalar search is exact linear scanning; FTS5 supplies an indexed lexical branch.
At large corpora, benchmark vector scanning before choosing an acceleration strategy.

A throwaway local probe on macOS arm64 verified the shared driver with Node 22.23.3 and Bun 1.4.4, `better-sqlite3` 13.0.3, sqlite-vec 0.1.9, and SQLite 3.53.4.
It passed extension loading, FTS5, scoped retrieval, rollback, update/delete, reopen, and Node↔Bun persistence. The root package still contains none of this implementation.
The expanded [local benchmark](BENCHMARKS.md) uses the user-selected 10,000 and 100,000 records and tests unfiltered, 50%, and 1% metadata scopes. It favors `vec0` for broad scans and indexed scalar queries for selective filters; neither is universally faster.
These are warm in-memory vector-only measurements with synthetic data, not production capacity or end-to-end memory retrieval results.
The simpler scalar layout remains the initial recommendation, subject to the real workload and latency budget. Revisit `vec0` when broad searches dominate; account for metadata-filter behavior and atomic lifecycle maintenance as well as query latency.
Both scalar vectors and queries require finite, nonzero Float32 validation: dimension/byte-length checks alone accept NaN, Infinity, or zero vectors, whose cosine distance can be SQL NULL and sort ahead of valid distances.

The dual-driver option has a specific macOS cost: Bun's system SQLite cannot load extensions, so `bun:sqlite` requires a custom SQLite library configured before opening a connection.
The verified shared `better-sqlite3` integration avoids that particular setup path on the tested macOS host.
Consult current [Bun SQLite](https://bun.com/docs/runtime/sqlite), [sqlite-vec JavaScript integration](https://alexgarcia.xyz/sqlite-vec/js.html), and [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) guidance when pinning versions.

## What to retain, change, and omit

**Retain:** non-generative memory operations; semantic + exact-term retrieval; local conversational context; source-bearing evidence; a separate reader; explicit model/data/configuration provenance in evaluations.

**Change:** file caches to transactional SQL; text-derived identity to caller IDs; parsed benchmark markers to typed metadata; weighted raw-score mixtures to a small rank-fusion baseline; inferred boundaries to mandatory namespace ownership and explicit filters.

**Omit initially:** spaCy/PyTorch dependencies, graph activation/PPR, overlapping hierarchy embeddings, density routing, English answer-slot rules, automatic support harvesting, cross-encoders, deterministic answer rewriting, benchmark-specific importers, and resume orchestration.
Omission means their value must be demonstrated against the simpler baseline before adding them.

## Validation lessons

The inspected repository did not contain tracked `tests/` files; this is an inventory observation, not proof that the authors performed no testing.
The code has several carefully implemented protections, including corpus isolation and reader-call/source consistency tracking, but these do not establish incremental storage correctness or equivalent retrieval variants.

[`_normalize_question_item`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/data_io.py#L393) keeps dataset category in evaluation metadata rather than treating it as a runtime routing instruction.
Preserve that principle: gold answers, evidence labels, and benchmark categories must never enter the retrieval request.
[`snapshot_source_files`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/data_io.py#L617) and [`save_run_metadata`](https://github.com/Zero-Mem/Zero-mem/blob/e1b2f8ef98a3d023478ddb2049aba11753296d42/src/data_io.py#L646) show the value of tying results to source, configuration, and dataset identity.

one-mem should begin with deterministic, independently authored fixtures for persistence, ranking, scope, updates, deletion, and budgets.
Evaluate dense, lexical, hybrid, and hybrid-with-neighbors at equal evidence budgets.
Measure retrieval recall separately from final-answer quality and count embedding, extraction, reranker, and generative calls separately.
Use licensed held-out data for promotion decisions; English and Vietnamese need separate reported results.
Record actual runtime, OS, architecture, SQLite, extension, and provider versions.
Only successful native tests on a platform support a compatibility claim for that platform.
