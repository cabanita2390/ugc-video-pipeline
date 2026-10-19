import request from 'supertest';
import { createTestApp, type TestApp } from './support/create-test-app.js';

describe('AppController (e2e)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  it('/ (GET)', () => {
    return request(t.app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await t.close();
  });
});
