import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';

// Import the modules to test and the DB pool to monkeypatch
import * as accessRepo from '../../src/modules/access/access.repository.ts';
import * as pool from '../../src/core/database/pool.ts';

// Helper to reset mocks between tests
function restoreMocks(orig: any, target: any) {
  for (const k of Object.keys(orig)) {
    (target as any)[k] = (orig as any)[k];
  }
}

describe('access.repository setAdminUnitAssignment (mocked DB)', () => {
  const originalQuery = (pool as any).databasePool.query;
  const originalConnect = (pool as any).databasePool.connect;

  afterEach(() => {
    (pool as any).databasePool.query = originalQuery;
    (pool as any).databasePool.connect = originalConnect;
  });

  it('sets assignment and returns result when user exists', async () => {
    // Mock findActiveUserByIdentifier's DB call via databasePool.query
    (pool as any).databasePool.query = async (sql: string, values: any[]) => {
      if (sql.includes('FROM mifabot.users u')) {
        return {
          rows: [
            {
              id: 'user-1',
              kode: 'USER',
              nama_lengkap: 'John Doe',
              username: 'johnd',
              jenis_kelamin: 'L',
              nomor_whatsapp: '628123456789',
              bulanan: null,
              tahunan: null,
              pendidikan: null,
              kesejahteraan: null,
            },
          ],
        };
      }
      // Fallback
      return { rows: [] };
    };

    // Mock databasePool.connect so withTransaction uses our fake client
    (pool as any).databasePool.connect = async () => {
      const fakeClient = {
        query: async (sql: string, params: any[]) => {
          if (sql.startsWith("SELECT id FROM mifabot.roles")) {
            return { rows: [{ id: 'role-admin-id' }] };
          }
          if (sql.startsWith('UPDATE mifabot.users')) {
            return { rows: [] };
          }
          if (sql.startsWith('UPDATE mifabot.admin_assignments')) {
            return { rows: [] };
          }
          if (sql.startsWith('INSERT INTO mifabot.admin_assignments')) {
            return { rows: [{ id: 'assignment-1' }] };
          }
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          return { rows: [] };
        },
        release: () => {},
      };
      return fakeClient;
    };

    const res = await accessRepo.setAdminUnitAssignment('BENDAHARA_1', '@johnd');
    assert.equal(res.unitCode, 'BENDAHARA_1');
    assert.equal(res.username, 'johnd');
    assert.equal(res.userId, 'user-1');
  });

  it('throws when user not found', async () => {
    (pool as any).databasePool.query = async () => ({ rows: [] });

    try {
      await accessRepo.setAdminUnitAssignment('BENDAHARA_1', 'nonexist');
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.ok(/User tidak ditemukan/.test(err.message));
    }
  });
});
