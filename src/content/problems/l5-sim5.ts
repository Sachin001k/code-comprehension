import type { Problem } from '../types';

/**
 * L5 interview simulations: Citadel/HRT C++ feed handler, Optiver TS options pricer.
 * Generated content; code lives in template literals (backticks and ${ escaped).
 */
const problems: Problem[] = [
  {
    id: 'l5-sim-citadel-feed-handler',
    title: 'Feed Handler on Fire: Gaps, Snapshots and a Lock-Free Ring',
    level: 5,
    rating: 2900,
    lang: 'cpp',
    domain: 'market-data',
    companies: [
      'citadel',
      'hrt',
    ],
    tags: [
      'market-data',
      'sequence-gaps',
      'snapshot-recovery',
      'spsc-ring',
      'memory-ordering',
      'interview-simulation',
    ],
    summary: `An ITCH-style feed handler double-applies a message after snapshot recovery. Trace it, predict it, pin it, then reject a racy "latest wins" ring patch.`,
    context: `**Citadel / HRT-style systems round, 7 stages, one codebase, ~55 minutes.**

You are on the low-latency market data team. \`mdfh\` decodes a sequenced multicast feed, maintains an order-by-order book and publishes top-of-book to the strategy thread through a lock-free SPSC ring.

Yesterday, after a 2-packet loss at the open, the strategy's view of resting bid size at one level was **40 lots too small** until the next snapshot, and the execution volume counter disagreed with the exchange's. Nobody could reproduce it in unit tests.

Format: there is no AI assistant for most of this round and nothing compiles in your head for free; one stage asks you to predict the exact output of \`src/main.cpp\` (a deterministic, single-threaded replay). Read \`README.md\` first: the threading model and the exchange's sequencing rules matter.`,
    persona: 'agent-mode',
    files: [
      {
        path: 'README.md',
        content: `# mdfh — market data feed handler

Consumes the exchange's **sequenced multicast feed** (ITCH-like, fixed-width binary
messages), maintains a full order-by-order book per instrument, and publishes
top-of-book updates to the strategy thread through a lock-free SPSC ring.

\`\`\`
 UDP packet ──► wire::decode_packet ──► Sequencer ──► OrderBook
                                          │   ▲            │
                         gap detected ────┘   │            ▼
                    SnapshotRequester         │      FeedHandler::publish_tob
                    (TCP snapshot channel) ───┘            │
                                                           ▼
                                               SpscRing<TopOfBook>  ──► strategy thread
\`\`\`

## Threading model

* **Feed thread** (one per multicast group): owns \`FeedHandler\`, \`Sequencer\`,
  \`OrderBook\`. Everything in \`src/\` except the ring consumer side runs here.
  Nothing in the book or sequencer is shared, so there are no locks.
* **Snapshot thread**: talks TCP to the snapshot server. When a snapshot is
  complete it is *posted to the feed thread* (via the event loop, not shown here)
  so \`FeedHandler::on_snapshot\` also runs on the feed thread.
* **Strategy thread**: the single consumer of \`SpscRing::try_pop\`.

## Sequencing rules (exchange spec §4.2)

* Every message carries an implicit sequence number: \`header.first_seq + index\`.
* Sequence numbers are contiguous per channel. Heartbeats consume a number.
* A message with \`seq < expected\` is a retransmission/duplicate and is dropped.
* On a gap the handler buffers everything it receives, requests a snapshot, and
  when the snapshot (tagged with \`last_seq\`, the last message *included* in it)
  arrives it loads the book and replays buffered messages with \`seq > last_seq\`.

## Building

\`\`\`
cmake -B build -DMDFH_BUILD_TESTS=ON && cmake --build build && ./build/mdfh_tests
./build/mdfh_replay        # deterministic replay of a scripted session
\`\`\`
`,
        language: 'markdown',
      },
      {
        path: 'CMakeLists.txt',
        content: `cmake_minimum_required(VERSION 3.20)
project(mdfh CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -Werror -fno-exceptions)

add_library(mdfh src/wire.cpp src/order_book.cpp src/sequencer.cpp src/feed_handler.cpp)
target_include_directories(mdfh PUBLIC include)

add_executable(mdfh_replay src/main.cpp)
target_link_libraries(mdfh_replay mdfh)

option(MDFH_BUILD_TESTS "Build unit tests" OFF)
if(MDFH_BUILD_TESTS)
  add_executable(mdfh_tests tests/sequencer_test.cpp tests/ring_buffer_test.cpp)
  target_compile_definitions(mdfh_tests PRIVATE MDFH_BUILD_TESTS=1)
  target_link_libraries(mdfh_tests mdfh)
endif()
`,
        language: 'text',
      },
      {
        path: 'config/feed.yaml',
        content: `# Production channel configuration (loaded by the deployment wrapper, not by this library)
channels:
  - name: EQ-A
    multicast: 239.10.1.1:30001
    snapshot: 10.0.4.12:9100
    instruments: 412
ring:
  capacity: 4096            # must be a power of two (static_assert in ring_buffer.hpp)
recovery:
  max_buffered_messages: 200000
  snapshot_timeout_ms: 750
`,
        language: 'yaml',
      },
      {
        path: 'include/mdfh/messages.hpp',
        content: `#pragma once
#include <cstdint>
#include <vector>

namespace mdfh {

enum class MsgType : uint8_t { Add = 'A', Delete = 'D', Execute = 'E', Heartbeat = 'H' };
enum class Side : uint8_t { Bid = 'B', Ask = 'S' };

// Decoded, host-endian view of one wire message.
struct Message {
  uint64_t seq = 0;       // implicit: header.first_seq + index in packet
  MsgType type = MsgType::Heartbeat;
  uint64_t order_id = 0;
  Side side = Side::Bid;
  int64_t price = 0;      // integer ticks, never floating point
  uint32_t qty = 0;
};

struct SnapshotOrder {
  uint64_t order_id;
  Side side;
  int64_t price;
  uint32_t qty;
};

// A full book image. last_seq is the sequence number of the LAST message whose
// effect is already included in \`orders\`.
struct Snapshot {
  uint64_t last_seq = 0;
  std::vector<SnapshotOrder> orders;
};

struct TopOfBook {
  uint64_t seq = 0;
  int64_t bid = 0;     // 0 => no bid
  uint32_t bid_qty = 0;
  int64_t ask = 0;     // 0 => no ask
  uint32_t ask_qty = 0;
};

}  // namespace mdfh
`,
      },
      {
        path: 'include/mdfh/wire.hpp',
        content: `#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

#include "messages.hpp"

namespace mdfh::wire {

// Packet layout (little endian, no padding):
//   header : u64 first_seq | u16 count
//   body   : count x 30-byte messages
//            u8 type | u64 order_id | u8 side | i64 price | u32 qty | 8 bytes reserved
constexpr std::size_t kHeaderSize = 10;
constexpr std::size_t kMessageSize = 30;

enum class DecodeError { None, Truncated, BadType };

// Appends decoded messages to \`out\`. On error nothing is appended.
DecodeError decode_packet(const uint8_t* data, std::size_t len, std::vector<Message>& out);

// Used by the replay tool and tests to build packets.
std::vector<uint8_t> encode_packet(uint64_t first_seq, const std::vector<Message>& msgs);

}  // namespace mdfh::wire
`,
      },
      {
        path: 'include/mdfh/order_book.hpp',
        content: `#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <unordered_map>

#include "messages.hpp"

namespace mdfh {

struct BookStats {
  uint64_t unknown_order_refs = 0;  // Delete/Execute for an order we never saw
  uint64_t duplicate_adds = 0;
  uint64_t executed_qty = 0;
};

class OrderBook {
 public:
  void apply(const Message& m);
  void load(const Snapshot& s);  // replaces the whole book
  void clear();

  TopOfBook top(uint64_t seq) const;
  uint64_t qty_at(Side side, int64_t price) const;

  // Levels best-first, for printing.
  const std::map<int64_t, uint64_t, std::greater<int64_t>>& bids() const { return bids_; }
  const std::map<int64_t, uint64_t>& asks() const { return asks_; }
  const BookStats& stats() const { return stats_; }

 private:
  struct Order {
    Side side;
    int64_t price;
    uint32_t qty;
  };

  void add(uint64_t id, Side side, int64_t price, uint32_t qty);
  void reduce(uint64_t id, uint32_t qty, bool is_execution);
  void level_sub(Side side, int64_t price, uint64_t qty);

  std::unordered_map<uint64_t, Order> orders_;
  std::map<int64_t, uint64_t, std::greater<int64_t>> bids_;  // best (highest) first
  std::map<int64_t, uint64_t> asks_;                          // best (lowest) first
  BookStats stats_;
};

}  // namespace mdfh
`,
      },
      {
        path: 'include/mdfh/ring_buffer.hpp',
        content: `#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>

namespace mdfh {

// Single-producer / single-consumer bounded queue.
//   producer: feed thread   (only writer of head_)
//   consumer: strategy thread (only writer of tail_)
// Indices are free-running 32-bit counters; the slot is index & (N - 1).
template <typename T, std::size_t N>
class SpscRing {
  static_assert(N >= 2 && (N & (N - 1)) == 0, "N must be a power of two");
  static_assert(N <= (std::size_t(1) << 31), "N must fit the index space");

 public:
  bool try_push(const T& v) {
    const uint32_t head = head_.load(std::memory_order_relaxed);  // we own head_
    const uint32_t tail = tail_.load(std::memory_order_acquire);
    if (head - tail == N) return false;  // full; unsigned wrap-around is intended
    slots_[head & (N - 1)] = v;
    head_.store(head + 1, std::memory_order_release);  // publish the slot
    return true;
  }

  bool try_pop(T& out) {
    const uint32_t tail = tail_.load(std::memory_order_relaxed);  // we own tail_
    const uint32_t head = head_.load(std::memory_order_acquire);
    if (head == tail) return false;  // empty
    out = slots_[tail & (N - 1)];
    tail_.store(tail + 1, std::memory_order_release);  // hand the slot back
    return true;
  }

  std::size_t size_approx() const {
    return head_.load(std::memory_order_acquire) - tail_.load(std::memory_order_acquire);
  }

  static constexpr std::size_t capacity() { return N; }

 private:
  alignas(64) std::atomic<uint32_t> head_{0};
  alignas(64) std::atomic<uint32_t> tail_{0};
  alignas(64) T slots_[N];
};

}  // namespace mdfh
`,
      },
      {
        path: 'include/mdfh/sequencer.hpp',
        content: `#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>

#include "messages.hpp"
#include "order_book.hpp"

namespace mdfh {

class SnapshotRequester {
 public:
  virtual ~SnapshotRequester() = default;
  virtual void request_snapshot() = 0;  // async; must not block the feed thread
};

struct SequencerStats {
  uint64_t applied = 0;
  uint64_t duplicates = 0;
  uint64_t gaps = 0;
  uint64_t recoveries = 0;
  uint64_t stale_snapshots = 0;
  uint64_t buffer_overflows = 0;
};

class Sequencer {
 public:
  enum class State { Live, Recovering };
  using AppliedFn = std::function<void(const Message&)>;

  Sequencer(OrderBook& book, SnapshotRequester& requester, std::size_t max_buffered,
            uint64_t first_expected = 1);

  void on_message(const Message& m);
  void on_snapshot(const Snapshot& snap);
  void set_on_applied(AppliedFn fn) { on_applied_ = std::move(fn); }

  State state() const { return state_; }
  uint64_t expected() const { return expected_; }
  std::size_t buffered() const { return pending_.size(); }
  const SequencerStats& stats() const { return stats_; }

 private:
  void apply(const Message& m);
  void buffer(const Message& m);
  void enter_recovery();

  OrderBook& book_;
  SnapshotRequester& requester_;
  const std::size_t max_buffered_;
  uint64_t expected_;
  State state_ = State::Live;
  std::map<uint64_t, Message> pending_;  // ordered by seq; only used while Recovering
  SequencerStats stats_;
  AppliedFn on_applied_;
};

}  // namespace mdfh
`,
      },
      {
        path: 'include/mdfh/feed_handler.hpp',
        content: `#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

#include "messages.hpp"
#include "order_book.hpp"
#include "ring_buffer.hpp"
#include "sequencer.hpp"

namespace mdfh {

struct HandlerStats {
  uint64_t packets = 0;
  uint64_t bad_packets = 0;
  uint64_t published = 0;
  uint64_t publish_drops = 0;  // ring full: strategy thread is behind
};

template <std::size_t RingN>
class FeedHandler {
 public:
  using Ring = SpscRing<TopOfBook, RingN>;

  FeedHandler(SnapshotRequester& requester, Ring& ring, std::size_t max_buffered)
      : ring_(ring), seq_(book_, requester, max_buffered) {
    seq_.set_on_applied([this](const Message& m) {
      if (m.type != MsgType::Heartbeat) publish_tob(m.seq);
    });
  }

  // Called on the feed thread for every datagram.
  void on_packet(const uint8_t* data, std::size_t len);

  // Posted to the feed thread by the snapshot thread.
  void on_snapshot(const Snapshot& snap) {
    const auto before = seq_.stats().recoveries;
    seq_.on_snapshot(snap);
    if (seq_.stats().recoveries != before) publish_tob(snap.last_seq);
  }

  const OrderBook& book() const { return book_; }
  const Sequencer& sequencer() const { return seq_; }
  const HandlerStats& stats() const { return stats_; }

 private:
  void publish_tob(uint64_t seq) {
    if (ring_.try_push(book_.top(seq))) ++stats_.published;
    else ++stats_.publish_drops;  // never block the feed thread
  }

  OrderBook book_;
  Ring& ring_;
  Sequencer seq_;
  HandlerStats stats_;
  std::vector<Message> scratch_;  // reused across packets: no allocation on the hot path
};

}  // namespace mdfh

#include "../../src/feed_handler.inl"
`,
      },
      {
        path: 'src/wire.cpp',
        content: `#include "../include/mdfh/wire.hpp"

#include <cstring>

namespace mdfh::wire {
namespace {

// The packet buffer is not aligned for 8-byte loads, so we never
// reinterpret_cast into it; memcpy compiles to a single unaligned mov.
template <typename T>
T load_le(const uint8_t* p) {
  T v;
  std::memcpy(&v, p, sizeof(T));
  return v;  // all supported targets are little endian (see static_assert below)
}

template <typename T>
void store_le(uint8_t* p, T v) {
  std::memcpy(p, &v, sizeof(T));
}

static_assert(sizeof(int64_t) == 8 && sizeof(uint32_t) == 4, "wire sizes");

bool valid_type(uint8_t t) {
  return t == 'A' || t == 'D' || t == 'E' || t == 'H';
}

}  // namespace

DecodeError decode_packet(const uint8_t* data, std::size_t len, std::vector<Message>& out) {
  if (len < kHeaderSize) return DecodeError::Truncated;
  const uint64_t first_seq = load_le<uint64_t>(data);
  const uint16_t count = load_le<uint16_t>(data + 8);
  if (len < kHeaderSize + std::size_t(count) * kMessageSize) return DecodeError::Truncated;

  const std::size_t start = out.size();
  out.reserve(start + count);
  for (uint16_t i = 0; i < count; ++i) {
    const uint8_t* m = data + kHeaderSize + std::size_t(i) * kMessageSize;
    if (!valid_type(m[0])) {
      out.resize(start);  // all-or-nothing
      return DecodeError::BadType;
    }
    Message msg;
    msg.seq = first_seq + i;
    msg.type = static_cast<MsgType>(m[0]);
    msg.order_id = load_le<uint64_t>(m + 1);
    msg.side = static_cast<Side>(m[9]);
    msg.price = load_le<int64_t>(m + 10);
    msg.qty = load_le<uint32_t>(m + 18);
    out.push_back(msg);
  }
  return DecodeError::None;
}

std::vector<uint8_t> encode_packet(uint64_t first_seq, const std::vector<Message>& msgs) {
  std::vector<uint8_t> buf(kHeaderSize + msgs.size() * kMessageSize, 0);
  store_le<uint64_t>(buf.data(), first_seq);
  store_le<uint16_t>(buf.data() + 8, static_cast<uint16_t>(msgs.size()));
  for (std::size_t i = 0; i < msgs.size(); ++i) {
    uint8_t* m = buf.data() + kHeaderSize + i * kMessageSize;
    m[0] = static_cast<uint8_t>(msgs[i].type);
    store_le<uint64_t>(m + 1, msgs[i].order_id);
    m[9] = static_cast<uint8_t>(msgs[i].side);
    store_le<int64_t>(m + 10, msgs[i].price);
    store_le<uint32_t>(m + 18, msgs[i].qty);
  }
  return buf;
}

}  // namespace mdfh::wire
`,
      },
      {
        path: 'src/order_book.cpp',
        content: `#include "../include/mdfh/order_book.hpp"

namespace mdfh {

void OrderBook::apply(const Message& m) {
  switch (m.type) {
    case MsgType::Add:
      add(m.order_id, m.side, m.price, m.qty);
      break;
    case MsgType::Delete: {
      auto it = orders_.find(m.order_id);
      if (it == orders_.end()) {
        ++stats_.unknown_order_refs;
        return;
      }
      reduce(m.order_id, it->second.qty, /*is_execution=*/false);
      break;
    }
    case MsgType::Execute:
      reduce(m.order_id, m.qty, /*is_execution=*/true);
      break;
    case MsgType::Heartbeat:
      break;
  }
}

void OrderBook::add(uint64_t id, Side side, int64_t price, uint32_t qty) {
  auto [it, inserted] = orders_.emplace(id, Order{side, price, qty});
  if (!inserted) {
    // Exchange never reuses ids within a session; a repeat is a replay artefact.
    ++stats_.duplicate_adds;
    return;
  }
  if (side == Side::Bid) bids_[price] += qty;
  else asks_[price] += qty;
}

void OrderBook::reduce(uint64_t id, uint32_t qty, bool is_execution) {
  auto it = orders_.find(id);
  if (it == orders_.end()) {
    ++stats_.unknown_order_refs;
    return;
  }
  Order& o = it->second;
  const uint32_t take = qty < o.qty ? qty : o.qty;  // clamp: never go negative
  level_sub(o.side, o.price, take);
  o.qty -= take;
  if (is_execution) stats_.executed_qty += take;
  if (o.qty == 0) orders_.erase(it);
}

void OrderBook::level_sub(Side side, int64_t price, uint64_t qty) {
  if (side == Side::Bid) {
    auto lv = bids_.find(price);
    if (lv == bids_.end()) return;
    lv->second -= qty;
    if (lv->second == 0) bids_.erase(lv);
  } else {
    auto lv = asks_.find(price);
    if (lv == asks_.end()) return;
    lv->second -= qty;
    if (lv->second == 0) asks_.erase(lv);
  }
}

void OrderBook::load(const Snapshot& s) {
  // Statistics are session counters and deliberately survive a reload.
  orders_.clear();
  bids_.clear();
  asks_.clear();
  for (const auto& o : s.orders) add(o.order_id, o.side, o.price, o.qty);
}

void OrderBook::clear() {
  orders_.clear();
  bids_.clear();
  asks_.clear();
  stats_ = BookStats{};
}

TopOfBook OrderBook::top(uint64_t seq) const {
  TopOfBook t;
  t.seq = seq;
  if (!bids_.empty()) {
    t.bid = bids_.begin()->first;
    t.bid_qty = static_cast<uint32_t>(bids_.begin()->second);
  }
  if (!asks_.empty()) {
    t.ask = asks_.begin()->first;
    t.ask_qty = static_cast<uint32_t>(asks_.begin()->second);
  }
  return t;
}

uint64_t OrderBook::qty_at(Side side, int64_t price) const {
  if (side == Side::Bid) {
    auto it = bids_.find(price);
    return it == bids_.end() ? 0 : it->second;
  }
  auto it = asks_.find(price);
  return it == asks_.end() ? 0 : it->second;
}

}  // namespace mdfh
`,
      },
      {
        path: 'src/sequencer.cpp',
        content: `#include "../include/mdfh/sequencer.hpp"

namespace mdfh {

Sequencer::Sequencer(OrderBook& book, SnapshotRequester& requester, std::size_t max_buffered,
                     uint64_t first_expected)
    : book_(book), requester_(requester), max_buffered_(max_buffered), expected_(first_expected) {}

void Sequencer::on_message(const Message& m) {
  if (m.seq < expected_) {
    ++stats_.duplicates;  // retransmission or A/B line arbitration loser
    return;
  }
  if (state_ == State::Recovering) {
    buffer(m);
    return;
  }
  if (m.seq == expected_) {
    apply(m);
    return;
  }
  // m.seq > expected_: we lost [expected_, m.seq - 1]
  ++stats_.gaps;
  buffer(m);
  enter_recovery();
}

void Sequencer::buffer(const Message& m) {
  if (pending_.size() >= max_buffered_) {
    // Cannot hold more; drop the buffer and start over from a fresh snapshot.
    ++stats_.buffer_overflows;
    pending_.clear();
  }
  pending_.emplace(m.seq, m);  // a duplicate seq keeps the first copy
}

void Sequencer::enter_recovery() {
  state_ = State::Recovering;
  requester_.request_snapshot();
}

void Sequencer::on_snapshot(const Snapshot& snap) {
  if (state_ != State::Recovering) {
    ++stats_.stale_snapshots;
    return;
  }
  if (!pending_.empty() && snap.last_seq + 1 < pending_.begin()->first) {
    // Snapshot is older than everything we buffered: loading it would leave a hole.
    ++stats_.stale_snapshots;
    requester_.request_snapshot();
    return;
  }

  book_.load(snap);
  expected_ = snap.last_seq + 1;
  ++stats_.recoveries;

  // Discard buffered messages the snapshot already contains.
  pending_.erase(pending_.begin(), pending_.lower_bound(snap.last_seq));

  auto it = pending_.begin();
  while (it != pending_.end()) {
    if (it->first > expected_) break;  // another hole inside the buffer
    apply(it->second);
    it = pending_.erase(it);
  }

  if (pending_.empty()) {
    state_ = State::Live;
  } else {
    requester_.request_snapshot();  // still missing something; try again
  }
}

void Sequencer::apply(const Message& m) {
  book_.apply(m);
  expected_ = m.seq + 1;
  ++stats_.applied;
  if (on_applied_) on_applied_(m);
}

}  // namespace mdfh
`,
      },
      {
        path: 'src/feed_handler.inl',
        content: `// Template implementation for FeedHandler; included from feed_handler.hpp.
#include "../include/mdfh/wire.hpp"

namespace mdfh {

template <std::size_t RingN>
void FeedHandler<RingN>::on_packet(const uint8_t* data, std::size_t len) {
  ++stats_.packets;
  scratch_.clear();  // keeps capacity
  if (wire::decode_packet(data, len, scratch_) != wire::DecodeError::None) {
    ++stats_.bad_packets;
    return;
  }
  for (const Message& m : scratch_) seq_.on_message(m);
}

}  // namespace mdfh
`,
      },
      {
        path: 'src/main.cpp',
        content: `// mdfh_replay: deterministic replay of a scripted session (no sockets, one thread).
#include <cstdio>
#include <vector>

#include "../include/mdfh/feed_handler.hpp"
#include "../include/mdfh/wire.hpp"

using namespace mdfh;

namespace {

struct RecordingRequester : SnapshotRequester {
  int requests = 0;
  void request_snapshot() override { ++requests; }
};

Message add(uint64_t id, Side s, int64_t px, uint32_t q) { return {0, MsgType::Add, id, s, px, q}; }
Message exec(uint64_t id, uint32_t q) { return {0, MsgType::Execute, id, Side::Bid, 0, q}; }
Message del(uint64_t id) { return {0, MsgType::Delete, id, Side::Bid, 0, 0}; }

template <typename H>
void send(H& h, uint64_t first_seq, const std::vector<Message>& msgs) {
  auto pkt = wire::encode_packet(first_seq, msgs);
  h.on_packet(pkt.data(), pkt.size());
}

const char* state_name(Sequencer::State s) { return s == Sequencer::State::Live ? "LIVE" : "RECOVERING"; }

}  // namespace

int main() {
  RecordingRequester req;
  SpscRing<TopOfBook, 4> ring;
  FeedHandler<4> h(req, ring, /*max_buffered=*/1024);

  send(h, 1, {add(1, Side::Bid, 10000, 100), add(2, Side::Ask, 10010, 50)});
  send(h, 3, {add(3, Side::Bid, 10005, 30)});
  send(h, 2, {add(2, Side::Ask, 10010, 50)});                 // retransmission
  // packet carrying seq 4..5 is lost on the wire:
  //   4: exec(3, 10)   5: add(4, Ask, 10008, 20)
  send(h, 6, {exec(1, 40), del(2)});                          // seq 6, 7
  std::printf("after gap: state=%s expected=%llu buffered=%zu requests=%d\\n",
              state_name(h.sequencer().state()),
              (unsigned long long)h.sequencer().expected(), h.sequencer().buffered(), req.requests);

  Snapshot snap;
  snap.last_seq = 6;  // book image as of seq 6 (includes the execution on order 1)
  snap.orders = {{1, Side::Bid, 10000, 60},
                 {3, Side::Bid, 10005, 20},
                 {2, Side::Ask, 10010, 50},
                 {4, Side::Ask, 10008, 20}};
  h.on_snapshot(snap);
  send(h, 8, {add(5, Side::Bid, 10006, 5)});

  const auto& st = h.sequencer().stats();
  std::printf("state=%s expected=%llu applied=%llu dups=%llu gaps=%llu\\n",
              state_name(h.sequencer().state()), (unsigned long long)h.sequencer().expected(),
              (unsigned long long)st.applied, (unsigned long long)st.duplicates,
              (unsigned long long)st.gaps);
  for (const auto& [px, q] : h.book().bids()) std::printf("BID %lld x %llu\\n", (long long)px, (unsigned long long)q);
  for (const auto& [px, q] : h.book().asks()) std::printf("ASK %lld x %llu\\n", (long long)px, (unsigned long long)q);
  std::printf("executed=%llu published=%llu drops=%llu\\n",
              (unsigned long long)h.book().stats().executed_qty,
              (unsigned long long)h.stats().published, (unsigned long long)h.stats().publish_drops);

  TopOfBook t, last;
  int n = 0;
  while (ring.try_pop(t)) { last = t; ++n; }
  std::printf("drained=%d last: seq=%llu bid=%lld ask=%lld\\n", n, (unsigned long long)last.seq,
              (long long)last.bid, (long long)last.ask);
  return 0;
}
`,
      },
      {
        path: 'tests/sequencer_test.cpp',
        content: `// Built only with -DMDFH_BUILD_TESTS (see CMakeLists.txt).
#ifdef MDFH_BUILD_TESTS
#include <cassert>
#include <cstdio>

#include "../include/mdfh/sequencer.hpp"

using namespace mdfh;

namespace {
struct CountingRequester : SnapshotRequester {
  int n = 0;
  void request_snapshot() override { ++n; }
};
Message add(uint64_t seq, uint64_t id, int64_t px, uint32_t q) {
  return {seq, MsgType::Add, id, Side::Bid, px, q};
}
}  // namespace

void test_in_order_messages_are_applied() {
  OrderBook book;
  CountingRequester r;
  Sequencer s(book, r, 16);
  s.on_message(add(1, 1, 100, 10));
  s.on_message(add(2, 2, 101, 10));
  assert(s.expected() == 3);
  assert(book.qty_at(Side::Bid, 101) == 10);
  assert(r.n == 0);
}

void test_duplicate_is_dropped() {
  OrderBook book;
  CountingRequester r;
  Sequencer s(book, r, 16);
  s.on_message(add(1, 1, 100, 10));
  s.on_message(add(1, 1, 100, 10));
  assert(s.stats().duplicates == 1);
  assert(book.qty_at(Side::Bid, 100) == 10);
}

void test_gap_requests_snapshot_and_recovers() {
  OrderBook book;
  CountingRequester r;
  Sequencer s(book, r, 16);
  s.on_message(add(1, 1, 100, 10));
  s.on_message(add(3, 3, 102, 10));  // seq 2 lost
  assert(s.state() == Sequencer::State::Recovering);
  assert(r.n == 1);
  Snapshot snap;
  snap.last_seq = 2;
  snap.orders = {{1, Side::Bid, 100, 10}, {2, Side::Bid, 101, 10}};
  s.on_snapshot(snap);
  assert(s.state() == Sequencer::State::Live);
  assert(s.expected() == 4);
  assert(book.qty_at(Side::Bid, 102) == 10);
}

void test_ring_fifo_and_full();  // ring_buffer_test.cpp

int main() {
  test_ring_fifo_and_full();
  test_in_order_messages_are_applied();
  test_duplicate_is_dropped();
  test_gap_requests_snapshot_and_recovers();
  std::puts("sequencer tests passed");
  return 0;
}
#endif
`,
      },
      {
        path: 'tests/ring_buffer_test.cpp',
        content: `// Built only with -DMDFH_BUILD_TESTS (see CMakeLists.txt).
// NOTE: linked into the same binary as sequencer_test.cpp, which owns main().
#ifdef MDFH_BUILD_TESTS
#include <cassert>

#include "../include/mdfh/ring_buffer.hpp"

void test_ring_fifo_and_full() {
  mdfh::SpscRing<int, 4> r;
  for (int i = 0; i < 4; ++i) assert(r.try_push(i));
  assert(!r.try_push(99));  // full
  int v = -1;
  assert(r.try_pop(v) && v == 0);
  assert(r.try_push(4));
  for (int want = 1; want <= 4; ++want) assert(r.try_pop(v) && v == want);
  assert(!r.try_pop(v));
}
#endif
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: who owns what?',
        prompt: `Read \`README.md\`, \`include/mdfh/feed_handler.hpp\`, \`src/sequencer.cpp\` and \`src/wire.cpp\`. **Select all statements that are true of the code as written.**`,
        options: [
          '`OrderBook` and `Sequencer` are only touched by the feed thread, which is why neither needs a lock.',
          'The strategy thread reads the book directly through `FeedHandler::book()`.',
          `A message with \`seq < expected_\` is dropped and counted as a duplicate, even while the sequencer is Recovering.`,
          'When the ring is full, the feed thread spins until the strategy thread frees a slot.',
          'Sequence numbers are carried explicitly in every 30-byte wire message.',
          `\`wire.cpp\` uses \`memcpy\` instead of \`reinterpret_cast\` because packet buffers are not guaranteed to be suitably aligned for 8-byte loads.`,
        ],
        correct: [0, 2, 5],
        hints: [
          'Look at the order of the checks at the top of `Sequencer::on_message`.',
          `Find \`publish_tob\` and see what happens when \`try_push\` returns false. Then look at the wire layout comment in \`wire.hpp\`.`,
        ],
        explanation: `* **True:** single-writer design. The snapshot thread *posts* the snapshot to the feed thread (README), so \`on_snapshot\` also runs there. No shared mutable state, no locks.
* **False:** the strategy consumes \`SpscRing<TopOfBook>\`; \`book()\` is for the feed thread and tests.
* **True:** the \`m.seq < expected_\` check comes *before* the \`state_ == Recovering\` branch. (Note: during recovery \`expected_\` is frozen at the first missing seq, so anything at or above it is buffered.)
* **False:** \`publish_tob\` counts \`publish_drops\` and returns. Blocking the feed thread would make the kernel drop UDP packets, causing more gaps, which is far worse than dropping a TOB update.
* **False:** the sequence number is implicit: \`header.first_seq + index\` (assigned in \`decode_packet\`). That is why a lost packet is a *range* of missing seqs.
* **True:** dereferencing a misaligned \`int64_t*\` is undefined behaviour (and a strict-aliasing violation). \`memcpy\` of a fixed size compiles to one unaligned \`mov\` on x86, so it costs nothing. This is a classic red herring: it looks slow and it isn't.`,
        timeLimitSec: 360,
        focusFile: 'README.md',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a gap through recovery',
        prompt: `In \`src/main.cpp\` the packet carrying seq 4-5 is lost, so the next packet starts at seq 6 (messages 6 and 7) while \`expected_\` is 4. Later a snapshot with \`last_seq = 6\` arrives. **Order the steps** from the arrival of that packet until the handler is live again.`,
        items: [
          'FeedHandler::on_packet clears scratch_ and calls wire::decode_packet',
          'decode_packet assigns seq = first_seq + i, producing messages 6 and 7',
          'Sequencer::on_message(6): not a duplicate, state Live, 6 > expected_ so ++gaps',
          'buffer(6) stores it in pending_, then enter_recovery() sets Recovering and calls request_snapshot()',
          'Sequencer::on_message(7): state is Recovering, so it is buffered and not applied',
          `FeedHandler::on_snapshot -> Sequencer::on_snapshot: OrderBook::load replaces the book and expected_ = last_seq + 1`,
          'Buffered messages are applied in seq order; each apply() fires on_applied -> publish_tob',
          `pending_ is empty so state = Live; only then does FeedHandler publish a TOB tagged with snap.last_seq`,
        ],
        hints: [
          'Start at `FeedHandler::on_packet` in `feed_handler.inl`; the sequencer sees messages one at a time.',
          `In \`FeedHandler::on_snapshot\`, the \`publish_tob(snap.last_seq)\` call comes *after* \`seq_.on_snapshot(snap)\` returns.`,
        ],
        explanation: `The interesting detail is the last two steps. \`FeedHandler::on_snapshot\` calls \`seq_.on_snapshot\` first, and that call **already replays** the buffered messages, publishing a TOB for each. Only afterwards does the handler publish the "snapshot" TOB, tagged \`seq = snap.last_seq\`. So the strategy can see TOB seq 7 followed by a TOB labelled seq 6. The *contents* of that last update are current (it reads the book after replay), but the *label* goes backwards, and a consumer that drops "older" updates by seq would discard it. Spotting ordering effects like this is what a trace stage is for. Keep it in mind for the predict stage.

Also note that seq 7 is never compared with \`expected_\` while Recovering. Buffering is unconditional, and ordering is restored by \`std::map\` keyed on seq.`,
        timeLimitSec: 420,
        focusFile: 'src/feed_handler.inl',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Predict the replay',
        prompt: `\`src/main.cpp\` is a deterministic, single-threaded replay of yesterday's incident (ring capacity **4**, nothing drains it until the end). The snapshot's order image is **correct as of seq 6**. Predict **exactly** what it prints. It is compiled with \`clang++ -std=c++20\` together with every other \`.cpp\` file (the tests are \`#ifdef\`-guarded).`,
        entry: 'src/main.cpp',
        answer: `after gap: state=RECOVERING expected=4 buffered=2 requests=1
state=LIVE expected=9 applied=6 dups=1 gaps=1
BID 10006 x 5
BID 10005 x 20
BID 10000 x 20
ASK 10008 x 20
executed=40 published=4 drops=3
drained=4 last: seq=6 bid=10005 ask=10008`,
        options: [
          `after gap: state=RECOVERING expected=4 buffered=2 requests=1
state=LIVE expected=9 applied=6 dups=1 gaps=1
BID 10006 x 5
BID 10005 x 20
BID 10000 x 20
ASK 10008 x 20
executed=40 published=4 drops=3
drained=4 last: seq=6 bid=10005 ask=10008`,
          `after gap: state=RECOVERING expected=4 buffered=2 requests=1
state=LIVE expected=9 applied=5 dups=1 gaps=1
BID 10006 x 5
BID 10005 x 20
BID 10000 x 60
ASK 10008 x 20
executed=0 published=4 drops=2
drained=4 last: seq=7 bid=10005 ask=10008`,
          `after gap: state=RECOVERING expected=4 buffered=2 requests=1
state=LIVE expected=9 applied=6 dups=1 gaps=1
BID 10006 x 5
BID 10005 x 20
BID 10000 x 20
ASK 10008 x 20
executed=40 published=4 drops=3
drained=4 last: seq=8 bid=10006 ask=10008`,
          `after gap: state=RECOVERING expected=4 buffered=2 requests=1
state=LIVE expected=9 applied=6 dups=1 gaps=1
BID 10006 x 5
BID 10005 x 20
BID 10000 x 20
ASK 10008 x 20
executed=80 published=4 drops=3
drained=4 last: seq=6 bid=10005 ask=10008`,
          `after gap: state=RECOVERING expected=6 buffered=2 requests=1
state=LIVE expected=9 applied=6 dups=1 gaps=1
BID 10006 x 5
BID 10005 x 20
BID 10000 x 20
ASK 10008 x 20
ASK 10010 x 50
executed=40 published=4 drops=3
drained=4 last: seq=6 bid=10005 ask=10008`,
        ],
        hints: [
          `While Recovering, \`expected_\` stays at 4. Which messages are in \`pending_\` when the snapshot arrives, and which of them survive \`erase(begin, lower_bound(6))\`?`,
          `The snapshot already contains the execution at seq 6 (order 1 is at 60). What happens if seq 6 is applied again? Does \`executed_qty\` survive \`OrderBook::load\`?`,
          `Count \`try_push\` calls in order: seq 1, 2, 3, then everything the snapshot replay publishes, then the snapshot TOB, then seq 8. Only the first 4 fit.`,
        ],
        explanation: `Walk it:

1. Seq 1, 2, 3 are applied live (\`applied=3\`), and each pushes a TOB (ring 3/4).
2. The retransmitted seq 2 has \`seq < expected_ (4)\`, so \`dups=1\`.
3. Seq 6 arrives: a gap (\`gaps=1\`). It is buffered, state becomes RECOVERING, and one snapshot is requested. Seq 7 is buffered. The first line is \`expected=4 buffered=2 requests=1\`.
4. Snapshot \`last_seq=6\`: the book is reloaded (order 1 = 60), \`expected_=7\`. Then \`pending_.erase(begin, lower_bound(6))\` erases keys **< 6** only, so **seq 6 survives**. The loop applies it (\`6 > 7\` is false): Execute order 1 for 40 a second time, so the level goes 60 → **20** and \`executed_qty\` += 40. Then seq 7 deletes order 2 (ask 10010 disappears). \`applied=5\`.
5. Pushes: seq 6 replay is the 4th push and fills the ring. Seq 7, the snapshot TOB and seq 8 are dropped: \`published=4 drops=3\`.
6. Seq 8 is live: \`applied=6\`, \`expected=9\`.

\`executed=40\` is not 80, because seq 6 was never applied live. It was buffered. The counter only sees the replayed copy. (Even the *fixed* code shows a different kind of wrong number here: \`executed=0\`, because the lost seq 4 and the snapshotted seq 6 executions never pass through the counter. Session counters derived from messages are not recoverable from book snapshots.)

The drained "last" TOB is the **oldest-4** policy at work: the strategy sees seq 6, not seq 8. A drop-newest ring holds stale data exactly when the market is busiest. That is the motivation for the next request you'll get from the AI.`,
        timeLimitSec: 600,
        focusFile: 'src/main.cpp',
      },
      {
        id: 's4',
        kind: 'find-bug',
        title: 'Pin the double-apply',
        prompt: `You now know the symptom: a message already contained in the snapshot is applied again. **Click the line** responsible and choose the root cause. (The visible \`test_gap_requests_snapshot_and_recovers\` passes. Ask yourself why.)`,
        file: 'src/sequencer.cpp',
        lines: [59],
        options: [
          `\`lower_bound(snap.last_seq)\` keeps the buffered message whose seq == last_seq, which the snapshot already includes, so it is applied twice; the bound must be \`upper_bound(last_seq)\` (keys > last_seq survive)`,
          '`expected_` should be set to `snap.last_seq`, not `snap.last_seq + 1`',
          'The stale-snapshot check should be `snap.last_seq + 1 > pending_.begin()->first`',
          '`it = pending_.erase(it)` invalidates the iterator and the loop has undefined behaviour',
          '`OrderBook::load` does not reset `executed_qty`, so volume is double counted',
        ],
        correct: 0,
        hints: [
          'The snapshot\'s `last_seq` is the last message *included* in it (see `messages.hpp`).',
          '`lower_bound(k)` returns the first key `>= k`; `erase(begin, x)` removes `[begin, x)`.',
        ],
        explanation: `Line 59 is \`pending_.erase(pending_.begin(), pending_.lower_bound(snap.last_seq));\`. \`lower_bound(6)\` points at key 6 itself, and the half-open erase removes only keys < 6, so seq 6 stays in the buffer. The replay guard \`it->first > expected_\` only detects holes, not messages that are too *old*, so seq 6 is applied on top of a book that already contains it. Adds are idempotent here (\`duplicate_adds\`), Deletes of a missing order are harmless (\`unknown_order_refs\`), but **Executes are not idempotent**. That is why the symptom was "40 lots missing" and not a crash.

Fix: \`pending_.upper_bound(snap.last_seq)\` (or \`lower_bound(last_seq + 1)\`). A belt-and-braces version also makes \`apply\` ignore \`m.seq < expected_\`.

Why the unit test missed it: in that test the snapshot's \`last_seq\` (2) was a *lost* message, so it was never in \`pending_\`. The bug only shows when the snapshot boundary lands on a message you **did** receive, which is the common case in production, where the snapshot is taken some time after the gap.

The other options: \`expected_ = last_seq + 1\` is correct. The stale check (line 47) is correct: it rejects snapshots that end before the first buffered seq minus one. \`std::map::erase(it)\` returns the next valid iterator, which is the idiomatic pattern. Not resetting \`executed_qty\` is a deliberate design choice (session counter) and is not what changed the book.`,
        timeLimitSec: 420,
        focusFile: 'src/sequencer.cpp',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'Review the agent\'s "latest wins" ring',
        prompt: `The strategy team wants the freshest TOB during bursts, not the oldest. You asked the coding agent for a change. It edited two files and says all tests pass. **Review it.**`,
        persona: 'agent-mode',
        request: `When the SPSC ring is full we drop the NEWEST top-of-book. Make it "latest wins": when full, drop the oldest entry instead so the strategy always sees fresh data.`,
        aiReply: `Done! I updated \`ring_buffer.hpp\` and \`feed_handler.hpp\`, and added a test.

\`\`\`cpp
// ring_buffer.hpp
  // Never fails: if the ring is full, evict the oldest element.
  void push_overwrite(const T& v) {
    const uint32_t head = head_.load(std::memory_order_relaxed);
    const uint32_t tail = tail_.load(std::memory_order_acquire);
    if (head - tail == N) {
      // full: advance the consumer past the oldest entry
      tail_.fetch_add(1, std::memory_order_acq_rel);
    }
    slots_[head & (N - 1)] = v;
    head_.store(head + 1, std::memory_order_release);
  }
\`\`\`

\`\`\`cpp
// feed_handler.hpp
  void publish_tob(uint64_t seq) {
    ring_.push_overwrite(book_.top(seq));
    ++stats_.published;
  }
\`\`\`

\`fetch_add\` is an atomic read-modify-write, so the producer and consumer can't conflict on \`tail_\`. \`acq_rel\` gives us the ordering we need. The new test pushes 6 items into a 4-slot ring and pops \`2,3,4,5\` ✅. All 5 tests pass.`,
        options: [
          `Accept: \`fetch_add\` is atomic, so updating \`tail_\` from the producer is safe, and the single-threaded test proves the eviction order.`,
          `Reject: \`tail_\` now has two writers. The consumer's \`tail_.store(tail + 1)\` stores a value computed from an earlier load, so it can overwrite the producer's increments (tail moves backwards, \`head - tail\` exceeds N, and the full check \`== N\` never fires again). The producer can also rewrite the very slot the consumer is copying out (a data race and a torn \`TopOfBook\`). Keep the SPSC ownership and do conflation differently, e.g. a seqlock-protected "latest TOB" slot.`,
          'Reject: the `fetch_add` must be `memory_order_seq_cst`; with that change the patch is correct.',
          `Reject: \`head - tail == N\` overflows after 2^32 pushes, so the new full check must use 64-bit counters.`,
          'Accept, but add `static_assert(std::is_trivially_copyable_v<T>)` so the slot copy is a plain memcpy.',
        ],
        correct: 1,
        hints: [
          `The header comment says who is the *only* writer of \`tail_\`. What does \`try_pop\` do with \`tail_\` after reading the slot?`,
          `Interleave: the consumer loads \`tail = 5\`, then the producer evicts twice (tail 5→6→7), then the consumer stores \`tail = 6\`.`,
        ],
        explanation: `An SPSC ring is correct because each index has **exactly one writer**. \`try_pop\` does \`load tail (relaxed)\` → read slot → \`store tail+1 (release)\`. That is a non-atomic read-modify-write *by design*, which is safe only because nobody else writes \`tail_\`. The patch breaks that invariant:

* **Lost update / index corruption:** the consumer loads \`tail=5\`. The producer evicts twice (5→6→7) and writes two items. The consumer then stores \`6\`, so \`tail_\` moves **backwards**. Now \`head - tail = N + 1\`, the \`== N\` full check never matches again, and the producer silently overwrites unread slots forever.
* **Torn read / UB:** with the ring full, the slot being overwritten (\`head & (N-1)\`) is the same slot the consumer may be copying (\`tail & (N-1)\`). Two threads access a non-atomic \`TopOfBook\` concurrently, which is a data race (UB). In practice the strategy reads a bid from one update and an ask from another.
* **Duplicates / reordering:** if the eviction lands between the consumer's head load and its slot read, it pops the *newest* item, then later pops it again.

\`fetch_add\` being atomic only makes *that one instruction* indivisible. It does nothing for the consumer's separate load→store sequence, and stronger orderings (seq_cst) don't fix a protocol race. The 2^32 wrap is a red herring: \`N\` divides \`2^32\`, so modular subtraction stays correct. The single-threaded test can't exercise any of this, so "all tests pass" is not evidence. This is typical agent-mode overconfidence.

Better designs: the producer conflates (overwrite a single "latest TOB" slot guarded by a **seqlock**: odd/even version counter, readers retry), or the *consumer* drains the ring and keeps only the last element. Both keep a single writer per variable.`,
        timeLimitSec: 480,
        focusFile: 'include/mdfh/ring_buffer.hpp',
      },
      {
        id: 's6',
        kind: 'mcq',
        title: 'Interrogate the existing ring',
        prompt: 'The interviewer asks you to defend the *current* `SpscRing`. **Select all true statements.**',
        options: [
          `\`head - tail == N\` stays correct after the 32-bit counters wrap past 2^32, because unsigned subtraction is modular and N divides 2^32.`,
          `The acquire load of \`tail_\` in \`try_push\` could be relaxed: the producer never reads slot contents, so it needs no ordering with the consumer.`,
          `If \`head_.store\` in \`try_push\` were \`memory_order_relaxed\`, the consumer could see the new head and read a slot whose payload write is not yet visible to it.`,
          '`alignas(64)` on `head_` and `tail_` is required for correctness; without it items can be lost.',
          `Called from a third (monitoring) thread, \`size_approx()\` can return a value near 2^32, because \`tail_\` may be read after the consumer has advanced past the \`head_\` value loaded first.`,
        ],
        correct: [0, 2, 4],
        hints: [
          `Release/acquire pairs go in both directions: head publishes *data* to the consumer, tail hands a *slot* back to the producer.`,
          `For \`size_approx\`: two separate atomic loads are not a snapshot. Which one is loaded first, and can the other overtake it?`,
        ],
        explanation: `* **True:** e.g. \`head = 2\`, \`tail = 2^32 - 2\`: \`head - tail\` is 4 mod 2^32. Free-running counters with a power-of-two mask are the standard trick: no "one empty slot" waste, no wrap branch.
* **False:** the acquire on \`tail_\` pairs with the consumer's release store. It guarantees the consumer's **read of the slot** happened-before the producer **overwrites** it. With relaxed, the producer could reuse a slot whose copy-out is still in flight (formally a data race).
* **True:** the release store is what publishes \`slots_[i] = v\`. Without it, the write to the slot and the write to \`head_\` may become visible in either order (on ARM/POWER truly so; on x86 the *compiler* may still reorder).
* **False:** \`alignas(64)\` prevents **false sharing** (producer and consumer bouncing one cache line). It is a performance property, not a correctness one.
* **True:** \`size_approx\` loads \`head\` (h), then \`tail\`. Between the loads the producer can push more and the consumer can pop past \`h\`, so \`h - t\` wraps (unsigned 32-bit) to ~4 billion. From the producer or consumer thread it is safe, because the caller owns one of the two indices. For metrics, clamp the result or load \`tail\` first.`,
        timeLimitSec: 480,
        focusFile: 'include/mdfh/ring_buffer.hpp',
      },
      {
        id: 's7',
        kind: 'mcq',
        title: 'Follow-up: the open doubles',
        prompt: `Post-mortem: at the open, message rate doubled and the snapshot server took ~2 s to answer. The handler oscillated: gap → snapshot → "stale" → snapshot → … for 40 seconds. **Select all changes that address real failure modes in this code.**`,
        options: [
          `Size and bound recovery by time: \`buffer()\` clears \`pending_\` on overflow but stays Recovering, so a snapshot that ends before the new buffer start is rejected as stale and the cycle repeats. Size \`max_buffered\` from peak msg rate × snapshot latency (plus headroom), and re-request immediately on overflow.`,
          `For small gaps, request retransmission from the exchange's replay service (or arbitrate the A/B feeds) before falling back to a full snapshot.`,
          `Make \`request_snapshot()\` synchronous on the feed thread so no new messages arrive while it is outstanding.`,
          `Publish a "book stale / recovering" flag to the strategy when entering Recovering. The last TOB in the ring is otherwise indistinguishable from a live one.`,
          `Replace \`std::map pending_\` with \`std::unordered_map\` for O(1) inserts; replay order does not matter because \`apply()\` sets \`expected_\` from each message.`,
          `Monitor gaps/sec, recovery duration, buffered depth, \`stale_snapshots\`, \`buffer_overflows\` and \`publish_drops\`, alerting when recovery exceeds the snapshot timeout.`,
        ],
        correct: [0, 1, 3, 5],
        hints: [
          `Trace \`buffer()\` when \`pending_.size() >= max_buffered_\`: what is the first buffered seq afterwards, and what does the stale check in \`on_snapshot\` then do?`,
          'What happens to a UDP socket\'s receive buffer if the only thread reading it blocks for 2 s?',
        ],
        explanation: `* **Real:** after an overflow \`pending_\` restarts at a much later seq. Any snapshot whose \`last_seq + 1\` is below that start fails the stale check and triggers another request, which takes another 2 s and overflows again. The fix is capacity planning (rate × latency), plus an explicit re-request on overflow, plus a recovery timeout metric.
* **Real:** most gaps are one or two packets. Line arbitration (A/B feeds carry identical sequences) or a retransmit request recovers them in microseconds to milliseconds without a full book reload.
* **Wrong:** blocking the only reader of the multicast socket makes the kernel drop packets, so you get *more* gaps. Recovery must be asynchronous; the feed thread keeps buffering.
* **Real:** during recovery the strategy is looking at a frozen book. Without an explicit status bit it cannot distinguish "quiet market" from "we're blind", and it will quote on stale prices.
* **Wrong:** ordering is essential. \`apply()\` sets \`expected_ = m.seq + 1\` from whatever it applies, and the replay loop relies on ascending order to detect holes (\`it->first > expected_\`).
* **Real:** these are exactly the counters that would have made yesterday's incident (and this oscillation) visible within seconds.`,
        timeLimitSec: 420,
        focusFile: 'src/sequencer.cpp',
      },
    ],
  },
  {
    id: 'l5-sim-optiver-options-pricer',
    title: 'Options Pricer: Wings, Expiry and a Cache Keyed on Doubles',
    level: 5,
    rating: 2750,
    lang: 'typescript',
    domain: 'pricing',
    companies: [
      'optiver',
    ],
    tags: [
      'black-scholes',
      'greeks',
      'numerical-stability',
      'floating-point',
      'caching',
      'interview-simulation',
    ],
    summary: `Negative wing puts, NaN greeks at expiry and a 0% cache hit rate. Find why, fix the numerics, reject a toFixed() cache key and build the right one.`,
    context: `**Optiver-style AI-enabled round, 7 stages, one codebase, ~65 minutes.**

You've joined the index options market-making desk. The pricer (\`src/\`) is called by the quoter on every underlying tick and by risk every 250 ms. Three complaints landed this morning:

1. Risk shows **negative** prices and nonsense P&L for far out-of-the-money puts.
2. On expiry day, every 0DTE option that is exactly at the money shows **NaN** greeks, and the aggregated desk delta becomes NaN.
3. The quote cache added in 3.4.0 has a **near-zero hit rate** in production.

You have an AI assistant (it sounds confident; check what it says). Hidden tests grade the code stages. Read \`README.md\` and \`docs/numerics.md\` first.`,
    persona: 'confident-intern',
    files: [
      {
        path: 'README.md',
        content: `# vol-desk pricer

Black-Scholes(-Merton) pricer and greeks used by the index options market-making
desk. Quotes are requested by the quoter (~every underlying tick) and by the
risk aggregator (every 250 ms over every position).

## Layout

| path | what |
|------|------|
| \`src/config.ts\` | desk-wide numeric settings (quanta, tolerances, cache size) |
| \`src/math/normal.ts\` | standard normal pdf / cdf (via a Chebyshev \`erfc\`) |
| \`src/models/blackScholes.ts\` | d1/d2, prices |
| \`src/models/greeks.ts\` | analytic greeks |
| \`src/models/impliedVol.ts\` | safeguarded Newton implied vol |
| \`src/cache/quoteCache.ts\` | bounded quote cache |
| \`src/service/pricingService.ts\` | entry point: validate -> cache -> model |
| \`src/risk/chainRisk.ts\` | position-level greek aggregation (desk units) |
| \`scripts/demo.ts\` | prints a few quotes, used in the onboarding doc |

## Conventions

* \`expiryYears\` is ACT/365 year fraction (\`seconds / SECONDS_PER_YEAR\`).
* \`vol\` and \`rate\` are decimals (\`0.2\` = 20%); \`rate\` is continuously compounded.
* Greeks are returned **per unit** (vega per 1.00 of vol, theta per year).
  \`chainRisk.ts\` converts to desk units (vega per vol point, theta per day).
* No dividends: index forwards are handled upstream by adjusting \`spot\`.

## Running

\`\`\`
npx tsx scripts/demo.ts
npx jest
\`\`\`
`,
        language: 'markdown',
      },
      {
        path: 'package.json',
        content: `{
  "name": "vol-desk-pricer",
  "version": "3.4.1",
  "private": true,
  "scripts": {
    "demo": "tsx scripts/demo.ts",
    "test": "jest"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
`,
        language: 'json',
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist"
  },
  "include": ["src", "scripts", "tests"]
}
`,
        language: 'json',
      },
      {
        path: 'jest.config.js',
        content: `/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  // Numerical tests compare to 1e-8; keep them deterministic across machines.
  maxWorkers: 1,
};
`,
        language: 'javascript',
      },
      {
        path: 'CHANGELOG.md',
        content: `# Changelog

## 3.4.1
- Validation: allow \`expiryYears == 0\` so 0DTE options can be quoted until the close.

## 3.4.0
- Quote cache in front of the model (PRICING-240). EOD ladder runtime 41 s -> 9 s.

## 3.3.0
- Puts are now derived from calls via put-call parity so the quoted pair is
  always arbitrage-consistent (PRICING-212).
- Safeguarded Newton for implied vol (falls back to bisection).

## 3.2.0
- \`normCdf\` moved from \`1 - erf\` to \`erfc\` for tail accuracy.
`,
        language: 'markdown',
      },
      {
        path: 'docs/numerics.md',
        content: `# Numerics notes

* Prices are computed in IEEE-754 doubles. Spot ~1e2 means one ulp of spot is
  ~1.4e-14, so any formula that *subtracts* quantities of size S to obtain a
  small option value cannot be trusted below roughly 1e-13.
* \`normCdf\` is built on \`erfc\`, not \`1 - erf\`, so N(-8) is still ~6e-16 with
  7 significant digits instead of 0.
* \`N(d1) - 1\` (put delta) and \`0.5 * (lo + hi)\` bisection midpoints look
  suspicious in review but are fine: their absolute errors are ~1e-16.
* Cache keys: see \`src/cache/quoteCache.ts\`. Never compare doubles with \`===\`
  unless both sides came from the exact same arithmetic.
`,
        language: 'markdown',
      },
      {
        path: 'src/config.ts',
        content: `export const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export interface PricerConfig {
  /** Smallest distinguishable spot/strike move. Half a listed tick so mids are representable. */
  priceQuantum: number;
  /** Smallest distinguishable vol / rate move (decimal). */
  volQuantum: number;
  rateQuantum: number;
  /** Max cached quotes before FIFO eviction. */
  cacheCapacity: number;
  ivTolerance: number;
  ivMaxIterations: number;
}

export const DEFAULT_CONFIG: PricerConfig = {
  priceQuantum: 0.005,
  volQuantum: 1e-6,
  rateQuantum: 1e-6,
  cacheCapacity: 50_000,
  ivTolerance: 1e-10,
  ivMaxIterations: 100,
};
`,
      },
      {
        path: 'src/index.ts',
        content: `export { PricingService } from './service/pricingService';
export { makeHandler } from './service/handler';
export type { QuoteRequest, QuoteResponse } from './service/handler';
export { price, callPrice, d1d2 } from './models/blackScholes';
export { greeks } from './models/greeks';
export { impliedVol, ImpliedVolError } from './models/impliedVol';
export { bounds, withinBounds } from './models/bounds';
export { aggregate } from './risk/chainRisk';
export type { Position, DeskRisk } from './risk/chainRisk';
export { ladder } from './risk/scenario';
export { yearFraction, expiryInstant } from './util/time';
export { DEFAULT_CONFIG, SECONDS_PER_YEAR } from './config';
export type { PricerConfig } from './config';
export type { PricingInput, Quote, Greeks, OptionType } from './models/types';
`,
      },
      {
        path: 'src/math/normal.ts',
        content: `const INV_SQRT_2PI = 0.3989422804014327;
const SQRT1_2 = Math.SQRT1_2;

/**
 * Complementary error function, Chebyshev fit (Numerical Recipes "erfcc").
 * Fractional (relative) error < 1.2e-7 everywhere, including far tails,
 * which is why we use erfc rather than 1 - erf.
 */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. Uses erfc so N(x) keeps relative precision for x << 0. */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x * SQRT1_2);
}

export function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}
`,
      },
      {
        path: 'src/models/types.ts',
        content: `export type OptionType = 'call' | 'put';

export interface PricingInput {
  type: OptionType;
  spot: number;
  strike: number;
  /** ACT/365 year fraction. 0 means "expires now". */
  expiryYears: number;
  vol: number;
  rate: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  /** per 1.00 change in vol */
  vega: number;
  /** per year */
  theta: number;
  /** per 1.00 change in rate */
  rho: number;
}

export interface Quote {
  price: number;
  greeks: Greeks;
}
`,
      },
      {
        path: 'src/models/blackScholes.ts',
        content: `import { normCdf } from '../math/normal';
import { PricingInput } from './types';

export interface D1D2 {
  d1: number;
  d2: number;
  sqrtT: number;
  df: number; // discount factor e^{-rT}
}

export function d1d2(inp: PricingInput): D1D2 {
  const { spot, strike, expiryYears: t, vol, rate } = inp;
  const sqrtT = Math.sqrt(t);
  const volSqrtT = vol * sqrtT;
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * t) / volSqrtT;
  return { d1, d2: d1 - volSqrtT, sqrtT, df: Math.exp(-rate * t) };
}

export function callPrice(inp: PricingInput): number {
  const { d1, d2, df } = d1d2(inp);
  return inp.spot * normCdf(d1) - inp.strike * df * normCdf(d2);
}

export function price(inp: PricingInput): number {
  const call = callPrice(inp);
  if (inp.type === 'call') return call;
  // Derive the put through put-call parity so the pair can never be arbitraged
  // against each other: C - P = S - K e^{-rT}.
  return call - inp.spot + inp.strike * Math.exp(-inp.rate * inp.expiryYears);
}
`,
      },
      {
        path: 'src/models/greeks.ts',
        content: `import { normCdf, normPdf } from '../math/normal';
import { d1d2 } from './blackScholes';
import { Greeks, PricingInput } from './types';

export function greeks(inp: PricingInput): Greeks {
  const { spot: s, strike: k, vol, rate: r } = inp;
  const { d1, d2, sqrtT, df } = d1d2(inp);
  const pdf = normPdf(d1);

  // Gamma and vega are identical for calls and puts.
  const gamma = pdf / (s * vol * sqrtT);
  const vega = s * pdf * sqrtT;

  if (inp.type === 'call') {
    return {
      delta: normCdf(d1),
      gamma,
      vega,
      theta: (-s * pdf * vol) / (2 * sqrtT) - r * k * df * normCdf(d2),
      rho: k * inp.expiryYears * df * normCdf(d2),
    };
  }
  return {
    // N(d1) - 1 loses relative precision for deep OTM puts, but the absolute
    // error is ~1e-16, which is irrelevant for hedging.
    delta: normCdf(d1) - 1,
    gamma,
    vega,
    theta: (-s * pdf * vol) / (2 * sqrtT) + r * k * df * normCdf(-d2),
    rho: -k * inp.expiryYears * df * normCdf(-d2),
  };
}
`,
      },
      {
        path: 'src/models/impliedVol.ts',
        content: `import { DEFAULT_CONFIG } from '../config';
import { price } from './blackScholes';
import { greeks } from './greeks';
import { PricingInput } from './types';

const VOL_LO = 1e-4;
const VOL_HI = 5;

export class ImpliedVolError extends Error {}

/**
 * Safeguarded Newton: take the Newton step when it stays inside the current
 * bracket and vega is meaningful, otherwise bisect. Always converges for prices
 * inside the no-arbitrage bounds because price is monotone in vol.
 */
export function impliedVol(
  target: number,
  inp: Omit<PricingInput, 'vol'>,
  tol = DEFAULT_CONFIG.ivTolerance,
  maxIter = DEFAULT_CONFIG.ivMaxIterations,
): number {
  let lo = VOL_LO;
  let hi = VOL_HI;
  const at = (v: number) => price({ ...inp, vol: v });
  if (target < at(lo) - tol || target > at(hi) + tol) {
    throw new ImpliedVolError(\`price \${target} outside [\${at(lo)}, \${at(hi)}]\`);
  }

  let v = 0.2;
  for (let i = 0; i < maxIter; i++) {
    const diff = at(v) - target;
    if (Math.abs(diff) < tol) return v;
    if (diff > 0) hi = v;
    else lo = v;
    const vega = greeks({ ...inp, vol: v }).vega;
    const step = vega > 1e-12 ? diff / vega : Infinity;
    const next = v - step;
    v = next > lo && next < hi ? next : 0.5 * (lo + hi);
  }
  return v;
}
`,
      },
      {
        path: 'src/models/bounds.ts',
        content: `import { PricingInput } from './types';

/**
 * Model-free no-arbitrage bounds for European options on a non-dividend underlying.
 *   call: max(S - K e^{-rT}, 0) <= C <= S
 *   put : max(K e^{-rT} - S, 0) <= P <= K e^{-rT}
 */
export function bounds(inp: Omit<PricingInput, 'vol'>): { lower: number; upper: number } {
  const df = Math.exp(-inp.rate * inp.expiryYears);
  if (inp.type === 'call') {
    return { lower: Math.max(inp.spot - inp.strike * df, 0), upper: inp.spot };
  }
  return { lower: Math.max(inp.strike * df - inp.spot, 0), upper: inp.strike * df };
}

export function withinBounds(priceValue: number, inp: Omit<PricingInput, 'vol'>, tol = 1e-9): boolean {
  const { lower, upper } = bounds(inp);
  return priceValue >= lower - tol && priceValue <= upper + tol;
}
`,
      },
      {
        path: 'src/cache/quoteCache.ts',
        content: `import { PricingInput, Quote } from '../models/types';

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

/**
 * Bounded quote cache. Map iteration order is insertion order, so the first
 * key is always the oldest entry: FIFO eviction in O(1).
 */
export class QuoteCache {
  private readonly map = new Map<string, Quote>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly capacity: number) {}

  key(inp: PricingInput): string {
    return \`\${inp.spot}|\${inp.strike}|\${inp.expiryYears}|\${inp.vol}|\${inp.rate}\`;
  }

  getOrCompute(inp: PricingInput, compute: () => Quote): Quote {
    const k = this.key(inp);
    const hit = this.map.get(k);
    if (hit !== undefined) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const q = compute();
    if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
    this.map.set(k, q);
    return q;
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }

  clear(): void {
    this.map.clear();
  }
}
`,
      },
      {
        path: 'src/service/validation.ts',
        content: `import { PricingInput } from '../models/types';

export class ValidationError extends Error {}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateInput(inp: PricingInput): PricingInput {
  if (inp.type !== 'call' && inp.type !== 'put') throw new ValidationError('type must be call or put');
  if (!finite(inp.spot) || inp.spot <= 0) throw new ValidationError('spot must be > 0');
  if (!finite(inp.strike) || inp.strike <= 0) throw new ValidationError('strike must be > 0');
  // Expiring-today options are quoted until the close, so 0 is allowed.
  if (!finite(inp.expiryYears) || inp.expiryYears < 0) throw new ValidationError('expiryYears must be >= 0');
  if (!finite(inp.vol) || inp.vol < 0) throw new ValidationError('vol must be >= 0');
  // Negative rates are real (EUR, JPY, CHF): only require finiteness.
  if (!finite(inp.rate)) throw new ValidationError('rate must be finite');
  return inp;
}
`,
      },
      {
        path: 'src/service/pricingService.ts',
        content: `import { DEFAULT_CONFIG, PricerConfig } from '../config';
import { QuoteCache, CacheStats } from '../cache/quoteCache';
import { price } from '../models/blackScholes';
import { greeks } from '../models/greeks';
import { PricingInput, Quote } from '../models/types';
import { validateInput } from './validation';

export class PricingService {
  private readonly cache: QuoteCache;

  constructor(private readonly config: PricerConfig = DEFAULT_CONFIG) {
    this.cache = new QuoteCache(config.cacheCapacity);
  }

  quote(raw: PricingInput): Quote {
    const inp = validateInput(raw);
    return this.cache.getOrCompute(inp, () => ({ price: price(inp), greeks: greeks(inp) }));
  }

  quoteMany(inputs: PricingInput[]): Quote[] {
    return inputs.map((i) => this.quote(i));
  }

  cacheStats(): CacheStats {
    return this.cache.stats();
  }
}
`,
      },
      {
        path: 'src/service/handler.ts',
        content: `import { PricingService } from './pricingService';
import { ValidationError } from './validation';
import { yearFraction } from '../util/time';
import { OptionType } from '../models/types';

/** Wire format sent by the quoter over the internal RPC bus. */
export interface QuoteRequest {
  type: OptionType;
  spot: number;
  strike: number;
  expiryMs: number;
  vol: number;
  rate: number;
}

export interface QuoteResponse {
  status: 200 | 400;
  body: unknown;
}

export function makeHandler(svc: PricingService, clock: () => number = Date.now) {
  return function handle(req: QuoteRequest): QuoteResponse {
    try {
      const q = svc.quote({
        type: req.type,
        spot: req.spot,
        strike: req.strike,
        expiryYears: yearFraction(clock(), req.expiryMs),
        vol: req.vol,
        rate: req.rate,
      });
      return { status: 200, body: q };
    } catch (e) {
      if (e instanceof ValidationError) return { status: 400, body: { error: e.message } };
      throw e;
    }
  };
}
`,
      },
      {
        path: 'src/risk/chainRisk.ts',
        content: `import { PricingService } from '../service/pricingService';
import { PricingInput } from '../models/types';

export interface Position {
  contract: PricingInput;
  /** signed number of contracts */
  quantity: number;
  multiplier: number;
}

export interface DeskRisk {
  /** $ delta: change in book value for a 1.00 move in spot */
  delta: number;
  gamma: number;
  /** $ per 1 vol point (0.01) */
  vega: number;
  /** $ per calendar day */
  theta: number;
}

const DAYS_PER_YEAR = 365;
const VOL_POINT = 0.01;

export function aggregate(svc: PricingService, positions: Position[]): DeskRisk {
  const out: DeskRisk = { delta: 0, gamma: 0, vega: 0, theta: 0 };
  for (const p of positions) {
    const { greeks } = svc.quote(p.contract);
    const n = p.quantity * p.multiplier;
    out.delta += n * greeks.delta;
    out.gamma += n * greeks.gamma;
    out.vega += n * greeks.vega * VOL_POINT;
    out.theta += (n * greeks.theta) / DAYS_PER_YEAR;
  }
  return out;
}
`,
      },
      {
        path: 'src/risk/scenario.ts',
        content: `import { PricingService } from '../service/pricingService';
import { Position } from './chainRisk';

export interface ScenarioCell {
  spotShift: number; // relative, e.g. -0.05 = spot down 5%
  volShift: number; // absolute, e.g. 0.02 = +2 vol points
  pnl: number;
}

/**
 * Full-revaluation P&L ladder used by the end-of-day risk report.
 * Every cell reprices every position, so a 9x5 ladder over 2k positions is
 * 90k quotes: this is the main consumer of the quote cache.
 */
export function ladder(
  svc: PricingService,
  positions: Position[],
  spotShifts: number[],
  volShifts: number[],
): ScenarioCell[] {
  const base = positions.reduce((acc, p) => acc + value(svc, p, 0, 0), 0);
  const cells: ScenarioCell[] = [];
  for (const ds of spotShifts) {
    for (const dv of volShifts) {
      const total = positions.reduce((acc, p) => acc + value(svc, p, ds, dv), 0);
      cells.push({ spotShift: ds, volShift: dv, pnl: total - base });
    }
  }
  return cells;
}

function value(svc: PricingService, p: Position, spotShift: number, volShift: number): number {
  const c = p.contract;
  const shocked = { ...c, spot: c.spot * (1 + spotShift), vol: Math.max(0, c.vol + volShift) };
  return svc.quote(shocked).price * p.quantity * p.multiplier;
}
`,
      },
      {
        path: 'src/util/time.ts',
        content: `import { SECONDS_PER_YEAR } from '../config';

const MS_PER_SECOND = 1000;

/**
 * ACT/365 year fraction between \`nowMs\` and the option's expiry instant.
 * Expired options return 0 (never negative) so the pricer sees "expires now".
 */
export function yearFraction(nowMs: number, expiryMs: number): number {
  const seconds = Math.max(0, (expiryMs - nowMs) / MS_PER_SECOND);
  return seconds / SECONDS_PER_YEAR;
}

/**
 * Exchange expiries settle at the 16:00 local close. \`dateUtcMs\` is midnight UTC
 * of the expiry date; \`closeOffsetHours\` is the close expressed in UTC hours
 * (e.g. 21 for New York in winter, 20 in summer).
 */
export function expiryInstant(dateUtcMs: number, closeOffsetHours: number): number {
  return dateUtcMs + closeOffsetHours * 3600 * MS_PER_SECOND;
}
`,
      },
      {
        path: 'scripts/demo.ts',
        content: `import { PricingService } from '../src/service/pricingService';

const svc = new PricingService();
const base = { spot: 100.02, strike: 100, expiryYears: 30 / 365, vol: 0.2, rate: 0.03 };

const call = svc.quote({ ...base, type: 'call' });
const put = svc.quote({ ...base, type: 'put' });
console.log(\`call=\${call.price.toFixed(4)} put=\${put.price.toFixed(4)}\`);

const mid = (100.01 + 100.03) / 2; // mid of the quoted market
svc.quote({ ...base, type: 'call', spot: mid });
console.log(\`mid=\${mid} \${JSON.stringify(svc.cacheStats())}\`);

const exp = svc.quote({ type: 'call', spot: 100, strike: 100, expiryYears: 0, vol: 0.2, rate: 0.03 });
console.log(\`expiry price=\${exp.price} delta=\${exp.greeks.delta}\`);
`,
      },
      {
        path: 'tests/blackScholes.test.ts',
        content: `import { price } from '../src/models/blackScholes';
import { greeks } from '../src/models/greeks';

const atm = { spot: 100, strike: 100, expiryYears: 1, vol: 0.2, rate: 0.05 };

test('textbook ATM call (Hull 15.6)', () => {
  expect(price({ ...atm, type: 'call' })).toBeCloseTo(10.4506, 3);
});

test('textbook ATM put', () => {
  expect(price({ ...atm, type: 'put' })).toBeCloseTo(5.5735, 3);
});

test('call delta is N(d1)', () => {
  expect(greeks({ ...atm, type: 'call' }).delta).toBeCloseTo(0.6368, 3);
});

test('put-call parity holds for liquid strikes', () => {
  const c = price({ ...atm, type: 'call', strike: 95 });
  const p = price({ ...atm, type: 'put', strike: 95 });
  expect(c - p).toBeCloseTo(100 - 95 * Math.exp(-0.05), 8);
});
`,
      },
      {
        path: 'tests/impliedVol.test.ts',
        content: `import { price } from '../src/models/blackScholes';
import { impliedVol } from '../src/models/impliedVol';

test('round-trips a liquid call', () => {
  const inp = { type: 'call' as const, spot: 100, strike: 105, expiryYears: 0.5, rate: 0.01 };
  const p = price({ ...inp, vol: 0.27 });
  expect(impliedVol(p, inp)).toBeCloseTo(0.27, 8);
});

test('rejects a price below intrinsic', () => {
  const inp = { type: 'call' as const, spot: 120, strike: 100, expiryYears: 0.5, rate: 0 };
  expect(() => impliedVol(5, inp)).toThrow('outside');
});
`,
      },
      {
        path: 'tests/quoteCache.test.ts',
        content: `import { QuoteCache } from '../src/cache/quoteCache';

const q = { price: 1, greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 } };
const inp = (strike: number) => ({ type: 'call' as const, spot: 100, strike, expiryYears: 0.5, vol: 0.2, rate: 0 });

test('second identical request is a hit', () => {
  const c = new QuoteCache(10);
  c.getOrCompute(inp(100), () => q);
  c.getOrCompute(inp(100), () => q);
  expect(c.stats()).toEqual({ hits: 1, misses: 1, size: 1 });
});

test('evicts oldest when full', () => {
  const c = new QuoteCache(2);
  for (const k of [100, 101, 102]) c.getOrCompute(inp(k), () => q);
  expect(c.stats().size).toBe(2);
});
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation',
        prompt: 'Skim the repo. **Select all statements that are true of the code as written.**',
        options: [
          'A put\'s price is derived from the call price via put-call parity in `blackScholes.price`.',
          'The quote cache key includes the option type.',
          '`validateInput` rejects `expiryYears == 0`.',
          `Greeks come back per unit (vega per 1.00 vol, theta per year); \`chainRisk\` converts to vega per vol point and theta per day.`,
          `\`impliedVol\` takes a Newton step only if it lands strictly inside the current bracket, otherwise it bisects.`,
          '`normCdf` is computed as `0.5 * (1 + erf(x / √2))`.',
        ],
        correct: [0, 3, 4],
        hints: [
          'Read `QuoteCache.key` character by character.',
          'CHANGELOG 3.4.1 and 3.2.0 are relevant.',
        ],
        explanation: `* **True:** \`price\` returns \`call - S + K e^{-rT}\` for puts (CHANGELOG 3.3.0). Keep this in mind: it matters a lot for the wing complaint.
* **False:** the key is \`spot|strike|expiry|vol|rate\`. There is **no type**, so a put and a call with the same parameters share an entry.
* **False:** 3.4.1 explicitly allows 0 so 0DTE options can be quoted.
* **True:** \`VOL_POINT = 0.01\` and \`/ 365\`. A red herring if you expected the model to return desk units.
* **True:** that is a *safeguarded* Newton, which is correct and convergent for in-bounds prices. A plain Newton from 0.2 diverges on the wings; this one does not.
* **False:** it is \`0.5 * erfc(-x/√2)\`, which keeps relative precision in the left tail (3.2.0).`,
        timeLimitSec: 360,
        focusFile: 'README.md',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a quote',
        prompt: 'Order what happens for `svc.quote({type: "call", ...})` when the cache **misses**.',
        items: [
          'PricingService.quote(raw)',
          'validateInput checks type, finiteness and ranges (expiry 0 allowed)',
          'QuoteCache.getOrCompute builds a string key from the raw doubles via key()',
          'Map lookup misses: misses++ and the compute closure runs',
          'price(inp) -> callPrice -> d1d2 -> normCdf(d1), normCdf(d2)',
          'greeks(inp) -> d1d2 again -> normPdf / normCdf',
          'FIFO eviction if size >= capacity, then map.set(key, quote)',
          'The quote object is returned (later hits return the same object)',
        ],
        hints: [
          'The compute closure in `pricingService.ts` evaluates `price` before `greeks` (object literal order).',
        ],
        explanation: `Validation runs **before** the cache, so invalid input never pollutes it. The key is computed from the **raw** input, and the model also prices the **raw** input. For the current code those are the same thing. Stage 6 separates them: once you snap keys to a grid, you must also price the snapped input, otherwise a cached value depends on which raw request arrived first.

Note that \`d1d2\` is computed twice per miss (once in \`price\`, once in \`greeks\`). That is a legitimate micro-optimisation, but not the bottleneck: the hit rate is.`,
        timeLimitSec: 360,
        focusFile: 'src/service/pricingService.ts',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Predict the onboarding demo',
        prompt: `Predict **exactly** what \`scripts/demo.ts\` prints. (The ATM-ish call is worth 2.4202. The correctly priced put with the same parameters would be 2.1539.)`,
        entry: 'scripts/demo.ts',
        answer: `call=2.4202 put=2.4202
mid=100.02000000000001 {"hits":1,"misses":2,"size":2}
expiry price=NaN delta=NaN`,
        options: [
          `call=2.4202 put=2.4202
mid=100.02000000000001 {"hits":1,"misses":2,"size":2}
expiry price=NaN delta=NaN`,
          `call=2.4202 put=2.1539
mid=100.02000000000001 {"hits":0,"misses":3,"size":3}
expiry price=NaN delta=NaN`,
          `call=2.4202 put=2.4202
mid=100.02 {"hits":2,"misses":1,"size":1}
expiry price=NaN delta=NaN`,
          `call=2.4202 put=2.4202
mid=100.02000000000001 {"hits":1,"misses":2,"size":2}
expiry price=0 delta=0.5`,
          `call=2.4202 put=2.4202
mid=100.02000000000001 {"hits":1,"misses":2,"size":2}
expiry price=0 delta=NaN`,
        ],
        hints: [
          'Line 1: does the put get its own cache entry?',
          `Line 2: is \`(100.01 + 100.03) / 2 === 100.02\` in IEEE-754 doubles? (\`0.1 + 0.2 !== 0.3\`.) Template literals print the shortest string that round-trips.`,
          'Line 3: with `t = 0` and `S = K`, what is `d1`? `Math.log(1) + 0` divided by `0.2 * 0`.',
        ],
        explanation: `* **Line 1:** the cache key has no option type, so the put request **hits the call's entry** and returns the call price, 2.4202 (correct put: 2.1539). One hit.
* **Line 2:** \`100.01\` and \`100.03\` are not exactly representable. Their sum, halved, rounds to the double just above 100.02, which prints as \`100.02000000000001\`. Different string, different key: a miss. So \`hits:1, misses:2, size:2\`. This is the production hit-rate problem in miniature: mids computed by arithmetic rarely match a spot that came straight off the feed, bit for bit.
* **Line 3:** \`d1 = (log(1) + (r + σ²/2)·0) / (σ·√0) = 0/0 = NaN\`. NaN propagates through \`normCdf\`, \`price\` and \`delta\`. (Off the money, \`±x/0 = ±Infinity\`, and \`erfc\` happens to return 0 or 2, so the price is "accidentally" right. That is why only *ATM* 0DTE options broke.) The NaN quote is then **cached**, so it keeps being served.`,
        timeLimitSec: 540,
        focusFile: 'scripts/demo.ts',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Fix the wings and the expiry singularity',
        prompt: `Fix the numerics in \`src/models/blackScholes.ts\` and \`src/models/greeks.ts\`. Hidden tests check:

1. **Deep OTM puts** keep *relative* precision (e.g. S=100, K=40, T=0.25, σ=0.2, r=0.03 is worth ≈ 8.37e-21, within 1e-4 relative), and no put price on the chain is ever negative.
2. **Degenerate cases** (\`expiryYears <= 0\` **or** \`vol <= 0\`): price is the discounted-forward intrinsic, \`max(S − K·e^{−rT}, 0)\` for calls and \`max(K·e^{−rT} − S, 0)\` for puts. Greeks are all finite, with \`gamma = vega = 0\`, call delta \`1\` if \`S > K·e^{−rT}\` else \`0\`, and put delta \`−1\` if \`S < K·e^{−rT}\` else \`0\`.
3. Textbook values (Hull) and implied vol still work.`,
        editable: [
          'src/models/blackScholes.ts',
          'src/models/greeks.ts',
        ],
        tests: [
          {
            path: 'tests/numerics.test.ts',
            content: `import { price } from '../src/models/blackScholes';
import { greeks } from '../src/models/greeks';
import { impliedVol } from '../src/models/impliedVol';

const wing = { type: 'put' as const, spot: 100, expiryYears: 0.25, vol: 0.2, rate: 0.03 };
const relErr = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const allFinite = (g: Record<string, number>) => Object.values(g).every((x) => Number.isFinite(x));

test('deep OTM puts keep relative precision', () => {
  // references: closed form with an exact erfc (Python math.erfc)
  expect(relErr(price({ ...wing, strike: 60 }), 1.5183940772817843e-7)).toBeLessThan(1e-4);
  expect(relErr(price({ ...wing, strike: 50 }), 1.1816337235200525e-12)).toBeLessThan(1e-4);
  expect(relErr(price({ ...wing, strike: 40 }), 8.372110853979675e-21)).toBeLessThan(1e-4);
});

test('no negative put prices anywhere on the chain', () => {
  for (const t of [1 / 365, 7 / 365, 0.25, 1]) {
    for (let k = 20; k <= 100; k += 0.5) {
      const p = price({ ...wing, strike: k, expiryYears: t });
      expect(p).toBeGreaterThanOrEqual(0);
    }
  }
});

test('put prices are monotone in strike on the wing', () => {
  let prev = -1;
  for (let k = 30; k <= 90; k += 1) {
    const p = price({ ...wing, strike: k, expiryYears: 7 / 365 });
    expect(p).toBeGreaterThanOrEqual(prev);
    prev = p;
  }
});

test('at expiry: intrinsic value and finite greeks', () => {
  const base = { spot: 105, expiryYears: 0, vol: 0.2, rate: 0.03 };
  expect(price({ ...base, type: 'call', strike: 100 })).toBeCloseTo(5, 12);
  expect(price({ ...base, type: 'put', strike: 100 })).toBe(0);
  expect(price({ ...base, type: 'put', strike: 110 })).toBeCloseTo(5, 12);
  expect(price({ ...base, type: 'call', strike: 105 })).toBe(0);
  for (const type of ['call', 'put'] as const) {
    for (const strike of [100, 105, 110]) {
      const g = greeks({ ...base, type, strike });
      expect(allFinite(g as unknown as Record<string, number>)).toBe(true);
      expect(g.gamma).toBe(0);
      expect(g.vega).toBe(0);
    }
  }
  expect(greeks({ ...base, type: 'call', strike: 100 }).delta).toBe(1);
  expect(greeks({ ...base, type: 'put', strike: 110 }).delta).toBe(-1);
});

test('zero vol: discounted forward intrinsic', () => {
  const base = { spot: 100, strike: 100, expiryYears: 1, vol: 0, rate: 0.05 };
  expect(price({ ...base, type: 'call' })).toBeCloseTo(100 - 100 * Math.exp(-0.05), 10);
  expect(price({ ...base, type: 'put' })).toBe(0);
  const g = greeks({ ...base, type: 'call' });
  expect(allFinite(g as unknown as Record<string, number>)).toBe(true);
  expect(g.delta).toBe(1);
});

test('textbook values and implied vol still work', () => {
  const atm = { spot: 100, strike: 100, expiryYears: 1, vol: 0.2, rate: 0.05 };
  expect(price({ ...atm, type: 'call' })).toBeCloseTo(10.4506, 3);
  expect(price({ ...atm, type: 'put' })).toBeCloseTo(5.5735, 3);
  expect(greeks({ ...atm, type: 'put' }).delta).toBeCloseTo(0.6368 - 1, 3);
  const inp = { type: 'put' as const, spot: 100, strike: 80, expiryYears: 0.1, rate: 0.01 };
  expect(impliedVol(price({ ...inp, vol: 0.45 }), inp)).toBeCloseTo(0.45, 7);
});
`,
          },
        ],
        solution: {
          'src/models/blackScholes.ts': `import { normCdf } from '../math/normal';
import { PricingInput } from './types';

export interface D1D2 {
  d1: number;
  d2: number;
  sqrtT: number;
  df: number; // discount factor e^{-rT}
}

export function d1d2(inp: PricingInput): D1D2 {
  const { spot, strike, expiryYears: t, vol, rate } = inp;
  const sqrtT = Math.sqrt(t);
  const volSqrtT = vol * sqrtT;
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * t) / volSqrtT;
  return { d1, d2: d1 - volSqrtT, sqrtT, df: Math.exp(-rate * t) };
}

/** No time value left (T == 0) or no randomness (vol == 0): the option is a forward payoff. */
export function isDegenerate(inp: PricingInput): boolean {
  return inp.expiryYears <= 0 || inp.vol <= 0;
}

export function callPrice(inp: PricingInput): number {
  return price({ ...inp, type: 'call' });
}

export function price(inp: PricingInput): number {
  const { spot: s, strike: k } = inp;
  if (isDegenerate(inp)) {
    const fwdStrike = k * Math.exp(-inp.rate * inp.expiryYears);
    return inp.type === 'call' ? Math.max(s - fwdStrike, 0) : Math.max(fwdStrike - s, 0);
  }
  const { d1, d2, df } = d1d2(inp);
  if (inp.type === 'call') return Math.max(s * normCdf(d1) - k * df * normCdf(d2), 0);
  // Price the put directly: both terms are small for OTM puts, so there is no
  // catastrophic cancellation (parity subtracts numbers of size S).
  // Clamp: far beyond the wing both terms are ~1e-300 and erfc's 1e-7 relative
  // error can leave a denormal of either sign.
  return Math.max(k * df * normCdf(-d2) - s * normCdf(-d1), 0);
}
`,
          'src/models/greeks.ts': `import { normCdf, normPdf } from '../math/normal';
import { d1d2, isDegenerate } from './blackScholes';
import { Greeks, PricingInput } from './types';

function degenerateGreeks(inp: PricingInput): Greeks {
  const { spot: s, strike: k, rate: r, expiryYears: t } = inp;
  const df = Math.exp(-r * t);
  const callItm = s > k * df;
  const putItm = s < k * df;
  if (inp.type === 'call') {
    return {
      delta: callItm ? 1 : 0,
      gamma: 0,
      vega: 0,
      theta: callItm ? -r * k * df : 0,
      rho: callItm ? k * t * df : 0,
    };
  }
  return {
    delta: putItm ? -1 : 0,
    gamma: 0,
    vega: 0,
    theta: putItm ? r * k * df : 0,
    rho: putItm ? -k * t * df : 0,
  };
}

export function greeks(inp: PricingInput): Greeks {
  if (isDegenerate(inp)) return degenerateGreeks(inp);
  const { spot: s, strike: k, vol, rate: r } = inp;
  const { d1, d2, sqrtT, df } = d1d2(inp);
  const pdf = normPdf(d1);

  // Gamma and vega are identical for calls and puts.
  const gamma = pdf / (s * vol * sqrtT);
  const vega = s * pdf * sqrtT;

  if (inp.type === 'call') {
    return {
      delta: normCdf(d1),
      gamma,
      vega,
      theta: (-s * pdf * vol) / (2 * sqrtT) - r * k * df * normCdf(d2),
      rho: k * inp.expiryYears * df * normCdf(d2),
    };
  }
  return {
    // N(d1) - 1 loses relative precision for deep OTM puts, but the absolute
    // error is ~1e-16, which is irrelevant for hedging.
    delta: normCdf(d1) - 1,
    gamma,
    vega,
    theta: (-s * pdf * vol) / (2 * sqrtT) + r * k * df * normCdf(-d2),
    rho: -k * inp.expiryYears * df * normCdf(-d2),
  };
}
`,
        },
        hints: [
          `Parity computes \`call − S + K·df\`: for K=40 the call is ≈ 60.3, so you subtract numbers of size ~100 to get ~1e-20. One ulp of 100 is ~1.4e-14.`,
          `Price the put directly: \`K·df·N(−d2) − S·N(−d1)\`. \`normCdf\` is built on \`erfc\`, so \`N(−d)\` is accurate deep in the tail.`,
          `Guard the singularity **before** computing d1/d2 (a shared \`isDegenerate(inp)\` helper keeps \`price\` and \`greeks\` consistent).`,
        ],
        explanation: `**Catastrophic cancellation.** Put-call parity is an exact identity in real numbers but a terrible *algorithm* in floating point when the result is much smaller than the operands. \`60.30… − 100 + 39.70…\` can only produce multiples of ~7e-15 (the ulp at those magnitudes): 0, or ±7.1e-15, or ±1.4e-14. A tiny *negative* price then breaks log-price fits, arbitrage checks and IV inversion on the wings. Computing \`K·df·N(−d2) − S·N(−d1)\` directly works because both terms are themselves tiny and \`erfc\` gives them ~1e-7 relative accuracy. Far beyond the wing (1-day expiry, K = 20) both terms are ~1e-300, and that 1e-7 relative error can still leave a denormal like -3e-322. Clamp the result at 0, the model-free lower bound. The 3.2.0 change to \`erfc\` was useless for puts until parity was removed.

Not everything that looks like cancellation is a bug: \`delta = N(d1) − 1\` has the same pattern, but its *absolute* error (~1e-16) is irrelevant for hedging. Judge numerical error relative to what the number is used for.

**The 0/0 singularity.** At \`T = 0\` or \`σ = 0\` the lognormal collapses to a point mass at the forward, so the limit of Black-Scholes is the discounted intrinsic on the forward, and the greeks are step functions (gamma/vega 0). Handle it explicitly rather than hoping IEEE arithmetic gets the limit right: \`±x/0\` happened to work, \`0/0\` did not. In production you'd also clamp tiny-but-positive \`σ√T\` (say < 1e-12) into the same branch.`,
        timeLimitSec: 900,
        focusFile: 'src/models/blackScholes.ts',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'The assistant fixes the cache key',
        prompt: 'Before you touch the cache, you ask the assistant. **Review its proposal.**',
        persona: 'confident-intern',
        request: `Our quote cache hit rate is ~0% in prod and the demo shows puts returning call prices. Fix QuoteCache.key.`,
        aiReply: `Classic floating-point keys! 😄 Round everything so tiny noise disappears, and add the missing option type:

\`\`\`ts
key(inp: PricingInput): string {
  return [
    inp.type,
    inp.spot.toFixed(2),
    inp.strike.toFixed(2),
    inp.expiryYears.toFixed(4),
    inp.vol.toFixed(4),
    inp.rate.toFixed(4),
  ].join('|');
}
\`\`\`

Now \`100.02000000000001\` and \`100.02\` both become \`"100.02"\` and share an entry. I didn't touch any pricing code, so there's **zero risk to the numbers**. Hit rate should jump to 90%+. 🚀`,
        options: [
          'Accept: the type is now in the key and float noise is rounded away.',
          `Reject: the buckets are wrong for this desk (1e-4 years ≈ 53 minutes, which merges distinct 0DTE expiries, and 2 dp on spot merges half-tick mids into a touch). Also, because the model still prices the *raw* input, each bucket caches whichever request arrived first, so results depend on arrival order. "Zero risk to the numbers" is false.`,
          'Reject: `toFixed` uses banker\'s rounding (round-half-to-even), which biases spot downwards.',
          'Reject: `Map` lookups with string keys are too slow; keys must be numbers.',
          'Accept, but use `toFixed(2)` for vol too to increase the hit rate further.',
        ],
        correct: 1,
        hints: [
          '`SECONDS_PER_YEAR × 1e-4` = ? An expiring-today option\'s value changes a lot in that time.',
          'Two requests with spot 100.1021 and 100.1009 share a key. Whose price is stored?',
        ],
        explanation: `Quantising a cache key is a **pricing decision**, not a refactor:

* \`toFixed(4)\` on year fractions buckets expiry into **3153.6 s ≈ 52.6 min** windows. For a 0DTE option ten minutes and an hour from expiry are wildly different prices, and they would share a cache entry. Time must be quantised in seconds (or finer).
* \`toFixed(2)\` on spot collapses the half-tick mid (e.g. 100.105) onto a touch. The desk's \`priceQuantum\` is 0.005 for exactly this reason.
* Most importantly, the cache stores \`compute()\` of the **raw** input. If 100.1021 arrives first, a later 100.1009 gets 100.1021's price, and the result depends on request order (non-deterministic risk, unreproducible P&L). If you snap the key, you must price the **snapped** input, so the cached value is a pure function of the key.

Distractors: \`Number.prototype.toFixed\` does not use banker's rounding. It rounds the exact binary value, which is why \`(100.105).toFixed(2)\` gives \`"100.11"\` while \`((100.1+100.11)/2).toFixed(2)\` gives \`"100.10"\`: yet another source of surprise. String keys in a \`Map\` are fine at this scale. Coarser vol buckets would make the problem worse.`,
        timeLimitSec: 420,
        focusFile: 'src/cache/quoteCache.ts',
      },
      {
        id: 's6',
        kind: 'code',
        task: 'feature',
        title: 'Build a canonical, quantised cache key',
        prompt: `Rework \`src/cache/quoteCache.ts\` (and the call site in \`src/service/pricingService.ts\`) so the cache is correct **and** useful:

* Snap every input to an integer grid using \`PricerConfig\`: spot and strike to \`priceQuantum\` (0.005), expiry to **whole seconds** (\`SECONDS_PER_YEAR\`), vol to \`volQuantum\`, rate to \`rateQuantum\`. The key must include the **option type**.
* The quote must be computed from the **snapped** input, so a cached value never depends on which raw request arrived first.
* Keep FIFO eviction at \`cacheCapacity\` and keep \`new QuoteCache(capacity)\` working (the visible tests use it).

Hidden tests cover float-noise hits, call/put separation, half-tick mids, 0DTE expiries one minute apart, order independence and capacity.`,
        editable: [
          'src/cache/quoteCache.ts',
          'src/service/pricingService.ts',
        ],
        tests: [
          {
            path: 'tests/cacheKey.test.ts',
            content: `import { PricingService } from '../src/service/pricingService';
import { DEFAULT_CONFIG, SECONDS_PER_YEAR } from '../src/config';

const base = { type: 'call' as const, spot: 100.02, strike: 100, expiryYears: 30 / 365, vol: 0.2, rate: 0.03 };

test('float noise in spot, vol and rate still hits', () => {
  const svc = new PricingService();
  svc.quote(base);
  svc.quote({ ...base, spot: (100.01 + 100.03) / 2 }); // 100.02000000000001
  svc.quote({ ...base, vol: 0.1 + 0.1 + 1e-12 });
  svc.quote({ ...base, rate: 0.1 * 0.3 }); // 0.030000000000000002
  svc.quote({ ...base, expiryYears: (30 * 86400) / SECONDS_PER_YEAR + 1e-12 });
  expect(svc.cacheStats()).toEqual({ hits: 4, misses: 1, size: 1 });
});

test('calls and puts never share an entry', () => {
  const svc = new PricingService();
  const c = svc.quote(base);
  const p = svc.quote({ ...base, type: 'put' });
  expect(svc.cacheStats().misses).toBe(2);
  expect(p.price).not.toBe(c.price);
  expect(p.greeks.delta).toBeLessThan(0);
});

test('half-tick mids are distinct from both touches', () => {
  const svc = new PricingService();
  svc.quote({ ...base, spot: 100.1 });
  svc.quote({ ...base, spot: 100.11 });
  svc.quote({ ...base, spot: (100.1 + 100.11) / 2 });
  expect(svc.cacheStats().misses).toBe(3);
});

test('0DTE expiries one minute apart are distinct', () => {
  const svc = new PricingService();
  const a = svc.quote({ ...base, expiryYears: 600 / SECONDS_PER_YEAR });
  const b = svc.quote({ ...base, expiryYears: 660 / SECONDS_PER_YEAR });
  expect(svc.cacheStats().misses).toBe(2);
  expect(a.price).not.toBe(b.price);
});

test('cached result does not depend on which raw request came first', () => {
  const r1 = { ...base, spot: 100.1021 };
  const r2 = { ...base, spot: 100.1009 }; // same half-tick bucket as r1
  const warm = new PricingService();
  warm.quote(r1);
  const fromCache = warm.quote(r2);
  expect(warm.cacheStats().hits).toBe(1);
  const cold = new PricingService();
  expect(cold.quote(r2)).toEqual(fromCache);
});

test('FIFO capacity still respected', () => {
  const svc = new PricingService({ ...DEFAULT_CONFIG, cacheCapacity: 2 });
  for (const strike of [95, 100, 105]) svc.quote({ ...base, strike });
  expect(svc.cacheStats().size).toBe(2);
});
`,
          },
        ],
        solution: {
          'src/cache/quoteCache.ts': `import { DEFAULT_CONFIG, PricerConfig, SECONDS_PER_YEAR } from '../config';
import { PricingInput, Quote } from '../models/types';

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

/**
 * Bounded quote cache. Map iteration order is insertion order, so the first
 * key is always the oldest entry: FIFO eviction in O(1).
 *
 * Doubles are never used as keys directly. Every input is snapped to an integer
 * grid (half-ticks, whole seconds, 1e-6 vol/rate) and the quote is computed from
 * the snapped ("canonical") input, so a cached value depends only on its key and
 * never on which raw request happened to arrive first.
 */
export class QuoteCache {
  private readonly map = new Map<string, Quote>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly capacity: number,
    private readonly config: PricerConfig = DEFAULT_CONFIG,
  ) {}

  canonical(inp: PricingInput): { key: string; input: PricingInput } {
    const c = this.config;
    const spotN = Math.round(inp.spot / c.priceQuantum);
    const strikeN = Math.round(inp.strike / c.priceQuantum);
    const secs = Math.round(inp.expiryYears * SECONDS_PER_YEAR);
    const volN = Math.round(inp.vol / c.volQuantum);
    const rateN = Math.round(inp.rate / c.rateQuantum);
    return {
      // \`\${-0}\` is "0", so -0 and 0 share a key.
      key: \`\${inp.type}|\${spotN}|\${strikeN}|\${secs}|\${volN}|\${rateN}\`,
      input: {
        type: inp.type,
        spot: spotN * c.priceQuantum,
        strike: strikeN * c.priceQuantum,
        expiryYears: secs / SECONDS_PER_YEAR,
        vol: volN * c.volQuantum,
        rate: rateN * c.rateQuantum,
      },
    };
  }

  key(inp: PricingInput): string {
    return this.canonical(inp).key;
  }

  getOrCompute(inp: PricingInput, compute: (canonical: PricingInput) => Quote): Quote {
    const { key: k, input } = this.canonical(inp);
    const hit = this.map.get(k);
    if (hit !== undefined) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const q = compute(input);
    if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
    this.map.set(k, q);
    return q;
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }

  clear(): void {
    this.map.clear();
  }
}
`,
          'src/service/pricingService.ts': `import { DEFAULT_CONFIG, PricerConfig } from '../config';
import { QuoteCache, CacheStats } from '../cache/quoteCache';
import { price } from '../models/blackScholes';
import { greeks } from '../models/greeks';
import { PricingInput, Quote } from '../models/types';
import { validateInput } from './validation';

export class PricingService {
  private readonly cache: QuoteCache;

  constructor(private readonly config: PricerConfig = DEFAULT_CONFIG) {
    this.cache = new QuoteCache(config.cacheCapacity, config);
  }

  quote(raw: PricingInput): Quote {
    const inp = validateInput(raw);
    // Price the canonical (snapped) input, never the raw one.
    return this.cache.getOrCompute(inp, (c) => ({ price: price(c), greeks: greeks(c) }));
  }

  quoteMany(inputs: PricingInput[]): Quote[] {
    return inputs.map((i) => this.quote(i));
  }

  cacheStats(): CacheStats {
    return this.cache.stats();
  }
}
`,
        },
        hints: [
          'Make one function return both the key and the canonical input, so they can never drift apart.',
          `\`Math.round(x / quantum)\` gives an integer; the canonical value is \`n * quantum\`. Integers print identically every time, and \`\${-0}\` is \`"0"\`.`,
          `Change \`getOrCompute\` to pass the canonical input to \`compute\`, and have \`PricingService\` price that argument instead of \`inp\`.`,
        ],
        explanation: `The core idea is **canonicalisation**: map every input to a representative on a grid that the business has agreed is "the same contract at the same market state", key on the *integers* (never the doubles), and evaluate the model at the representative. Then:

* \`100.02\` and \`100.02000000000001\` both snap to 20004 half-ticks: a hit.
* \`100.1021\` and \`100.1009\` both snap to 20020. The cached quote is the price at exactly 20020 × 0.005, the same value a cold service would compute for either input. That is order independence, which is what the "key only" approach fails.
* 0DTE expiries a minute apart are 60 integer seconds apart: distinct.

Choosing quanta is a trade-off. The price error you accept is about \`delta × priceQuantum/2 + vega × volQuantum/2 + theta × 0.5 s\`, which must be well below the desk's edge per contract. Write the bound down next to the config. Also note that the NaN-caching problem from stage 3 disappears only because stage 4 removed the NaN, so a defensive cache would refuse to store non-finite quotes.`,
        timeLimitSec: 900,
        focusFile: 'src/cache/quoteCache.ts',
      },
      {
        id: 's7',
        kind: 'mcq',
        title: 'Follow-up: 4x underlyings, quotes every tick',
        prompt: `The desk wants 4x the underlyings, greeks on every tick (~200k quotes/s) and the EOD ladder over 8k positions. **Select all sound statements** about the cache and pricer.`,
        options: [
          `Spot moves every tick, so the quoter's own hit rate stays low. The cache mainly pays off for repeated risk runs at an unchanged spot (every 250 ms) and for positions that share a contract.`,
          `FIFO eviction is O(1) thanks to Map insertion order, but if the working set exceeds capacity any FIFO/LRU cache thrashes towards 0% hits, so capacity must be sized from the working set, not just memory.`,
          'Switching the key to `JSON.stringify(input)` would fix float-noise misses.',
          `Snapping spot to 0.005 shifts prices by up to about delta × 0.0025, which is acceptable only because that is below the desk's quoting granularity. Document the bound next to the quanta.`,
          'Keying on the raw Float64 bit pattern (via a DataView) instead of a string would fix the hit rate.',
          `The cache must be flushed whenever the vol surface or rate curve updates, because the key does not depend on them.`,
        ],
        correct: [0, 1, 3],
        hints: [
          `What exactly is in the key after stage 6? Does a new vol from the surface produce the same key as the old vol?`,
          '`JSON.stringify(100.02000000000001)` is which string?',
        ],
        explanation: `* **Sound:** caching helps when inputs repeat. A quoter chasing a moving spot rarely repeats; risk at a fixed snapshot and shared contracts do. Measure the hit rate per caller before scaling the cache.
* **Sound:** eviction cost is fine, but a cache smaller than its working set (the ladder over 8k positions × 45 cells) evicts every entry before it is reused. Size it, or bypass the cache for one-shot scans.
* **Unsound:** \`JSON.stringify\` uses the same shortest-round-trip formatting as template literals. Distinct doubles stay distinct strings.
* **Sound:** quantisation is an approximation with a first-order error of delta × half-quantum (plus vega and theta terms). It is fine when it is below your granularity, and you should write the bound down.
* **Unsound:** a bit-pattern key is faster, but it is exactly as strict as the string. \`100.02\` and \`100.02000000000001\` differ in the last mantissa bit.
* **Unsound (trap):** vol and rate **are** in the key. A surface update changes the inputs and therefore the key, and old entries simply age out under FIFO. Flushing would only be needed for state hidden from the key, such as a model or calibration version.`,
        timeLimitSec: 420,
        focusFile: 'src/cache/quoteCache.ts',
      },
    ],
  },
];

export default problems;
