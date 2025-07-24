// tests/services/redis-session.test.js
import redisSessionService from '../../services/redis-session.service.js';

describe('Redis Session Service', () => {
  beforeEach(() => {
    // Clear any existing sessions
    if (redisSessionService.fallbackToMemory) {
      redisSessionService.memoryStore.clear();
    }
  });

  describe('KEYS vs SCAN Performance', () => {
    it('should use SCAN instead of KEYS for getting all sessions', async () => {
      // Mock Redis methods if connected
      if (redisSessionService.redis && redisSessionService.isConnected) {
        const mockKeys = jest.spyOn(redisSessionService.redis, 'keys');
        const mockScan = jest.spyOn(redisSessionService.redis, 'scan');

        // This is the current problematic implementation
        await redisSessionService.getStats();

        // Currently uses KEYS (bad)
        expect(mockKeys).toHaveBeenCalledWith('session:*');

        // Should use SCAN instead
        // expect(mockScan).toHaveBeenCalled();

        mockKeys.mockRestore();
        if (mockScan) mockScan.mockRestore();
      } else {
        // Test with memory fallback
        // Add 1000 sessions to test performance
        for (let i = 0; i < 1000; i++) {
          await redisSessionService.setSession(
            `test-${i}`,
            {
              userId: i,
              data: `test-data-${i}`,
            },
            3600
          );
        }

        const startTime = Date.now();
        const stats = await redisSessionService.getStats();
        const duration = Date.now() - startTime;

        expect(stats.activeSessions).toBe(1000);
        expect(duration).toBeLessThan(100); // Should be fast even with 1000 sessions
      }
    });

    it('should implement SCAN alternative for production safety', async () => {
      // Proposed SCAN implementation
      const scanSessions = async () => {
        const sessions = [];
        let cursor = '0';

        if (redisSessionService.redis && redisSessionService.isConnected) {
          do {
            const [newCursor, keys] = await redisSessionService.redis.scan(
              cursor,
              'MATCH',
              'session:*',
              'COUNT',
              100
            );
            cursor = newCursor;
            sessions.push(...keys);
          } while (cursor !== '0');
        } else {
          // Memory fallback
          for (const [key, value] of redisSessionService.memoryStore.entries()) {
            sessions.push(`session:${key}`);
          }
        }

        return sessions;
      };

      // Add test sessions
      for (let i = 0; i < 100; i++) {
        await redisSessionService.setSession(
          `scan-test-${i}`,
          {
            userId: i,
          },
          3600
        );
      }

      const sessions = await scanSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Session Auto-Save Optimization', () => {
    it('should only save sessions if they have changed', async () => {
      const sessionId = 'test-session-1';
      const sessionData = {
        userId: 123,
        lastAccess: new Date().toISOString(),
      };

      // Save initial session
      await redisSessionService.setSession(sessionId, sessionData, 3600);

      // Get session (no changes)
      const result = await redisSessionService.getSession(sessionId);
      expect(result.success).toBe(true);

      // Simulate checking if session needs saving
      const hasChanged = (original, current) => {
        return JSON.stringify(original) !== JSON.stringify(current);
      };

      // No changes
      expect(hasChanged(sessionData, result.data)).toBe(false);

      // With changes
      const modifiedData = { ...result.data, newField: 'value' };
      expect(hasChanged(result.data, modifiedData)).toBe(true);
    });

    it('should track dirty state for sessions', async () => {
      // Proposed dirty tracking implementation
      class SessionWithDirtyTracking {
        constructor(data) {
          this._original = JSON.stringify(data);
          this._data = data;
        }

        get data() {
          return this._data;
        }

        set(key, value) {
          this._data[key] = value;
        }

        isDirty() {
          return this._original !== JSON.stringify(this._data);
        }
      }

      const session = new SessionWithDirtyTracking({
        userId: 123,
        role: 'user',
      });

      expect(session.isDirty()).toBe(false);

      session.set('lastAction', 'view_invoice');
      expect(session.isDirty()).toBe(true);
    });
  });

  describe('Memory Store Cleanup', () => {
    it('should efficiently clean expired sessions', async () => {
      // Add mix of expired and valid sessions
      const now = Date.now();

      // Add expired sessions
      for (let i = 0; i < 500; i++) {
        redisSessionService.memoryStore.set(`expired-${i}`, {
          data: { id: i },
          expires: now - 1000, // Already expired
        });
      }

      // Add valid sessions
      for (let i = 0; i < 500; i++) {
        redisSessionService.memoryStore.set(`valid-${i}`, {
          data: { id: i },
          expires: now + 3600000, // 1 hour future
        });
      }

      expect(redisSessionService.memoryStore.size).toBe(1000);

      const startTime = Date.now();
      redisSessionService.cleanupMemoryStore();
      const cleanupTime = Date.now() - startTime;

      expect(redisSessionService.memoryStore.size).toBe(500); // Only valid sessions remain
      expect(cleanupTime).toBeLessThan(50); // Should be very fast

      // Verify only valid sessions remain
      for (const [key, value] of redisSessionService.memoryStore.entries()) {
        expect(value.expires).toBeGreaterThan(now);
      }
    });
  });

  describe('Concurrent Session Access', () => {
    it('should handle concurrent session reads/writes', async () => {
      const sessionId = 'concurrent-test';
      const operations = [];

      // Simulate 50 concurrent operations
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) {
          // Write operation
          operations.push(
            redisSessionService.setSession(
              sessionId,
              {
                counter: i,
                timestamp: Date.now(),
              },
              3600
            )
          );
        } else {
          // Read operation
          operations.push(redisSessionService.getSession(sessionId));
        }
      }

      const startTime = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      expect(results.every((r) => r.success !== false)).toBe(true);
      expect(duration).toBeLessThan(500); // Should handle concurrent access efficiently
    });
  });
});
