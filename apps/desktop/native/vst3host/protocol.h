// Framed protocol I/O, identical on the wire to the Swift AU helper (apps/desktop/src/shared/plughost-protocol.ts):
//   frame := magic u32 LE ("ORPH") | jsonLength u32 LE | binaryLength u32 LE | json | binary
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <utility>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#else
#include <unistd.h>
#include <cerrno>
#endif
#include "json.h"

namespace proto {

constexpr uint32_t kMagic = 0x4850524F;
constexpr uint32_t kMaxJson = 4u * 1024 * 1024;
constexpr uint32_t kMaxBin = 256u * 1024 * 1024;

inline int protocolOut = 1;

// Anything a plugin prints to stdout would corrupt the frame stream: frames go to a private copy of fd 1, fd 1 points at stderr.
inline void init() {
#ifdef _WIN32
    _setmode(0, _O_BINARY); _setmode(1, _O_BINARY);
    protocolOut = _dup(1);
    _dup2(2, 1);
#else
    protocolOut = dup(1);
    dup2(2, 1);
#endif
}

inline bool readExact(int fd, void* dst, size_t count) {
    auto* p = static_cast<uint8_t*>(dst);
    size_t got = 0;
    while (got < count) {
#ifdef _WIN32
        int n = _read(fd, p + got, static_cast<unsigned>(count - got));
        if (n <= 0) return false;
#else
        ssize_t n = read(fd, p + got, count - got);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
#endif
        got += static_cast<size_t>(n);
    }
    return true;
}

inline bool writeAll(int fd, const void* src, size_t count) {
    auto* p = static_cast<const uint8_t*>(src);
    size_t sent = 0;
    while (sent < count) {
#ifdef _WIN32
        int n = _write(fd, p + sent, static_cast<unsigned>(count - sent));
        if (n <= 0) return false;
#else
        ssize_t n = write(fd, p + sent, count - sent);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
#endif
        sent += static_cast<size_t>(n);
    }
    return true;
}

inline std::mutex& writeLock() { static std::mutex m; return m; }

inline void sendFrame(const json::Object& message, const void* binary = nullptr, size_t binaryLength = 0) {
    std::string body = json::dump(json::Value(message));
    uint8_t header[12];
    auto put = [&](size_t off, uint32_t v) { header[off] = v & 255; header[off + 1] = (v >> 8) & 255; header[off + 2] = (v >> 16) & 255; header[off + 3] = (v >> 24) & 255; };
    put(0, kMagic); put(4, static_cast<uint32_t>(body.size())); put(8, static_cast<uint32_t>(binaryLength));
    std::lock_guard<std::mutex> lock(writeLock());
    if (!writeAll(protocolOut, header, 12) || !writeAll(protocolOut, body.data(), body.size()) || (binaryLength && !writeAll(protocolOut, binary, binaryLength))) std::exit(3);
}

struct Frame { json::Value json; std::vector<uint8_t> binary; };

/** Reads one frame from stdin. False at end of input or on anything that is not a valid frame (the session then ends). */
inline bool readFrame(Frame& out) {
    uint8_t header[12];
    if (!readExact(0, header, 12)) return false;
    auto get = [&](size_t off) { return static_cast<uint32_t>(header[off]) | (static_cast<uint32_t>(header[off + 1]) << 8) | (static_cast<uint32_t>(header[off + 2]) << 16) | (static_cast<uint32_t>(header[off + 3]) << 24); };
    uint32_t magic = get(0), jl = get(4), bl = get(8);
    if (magic != kMagic || jl > kMaxJson || bl > kMaxBin) return false;
    std::string body(jl, '\0');
    if (jl && !readExact(0, &body[0], jl)) return false;
    out.binary.assign(bl, 0);
    if (bl && !readExact(0, out.binary.data(), bl)) return false;
    try {
        out.json = json::parse(body);
    } catch (...) { return false; }
    return out.json.isObject();
}

} // namespace proto
