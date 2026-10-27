.PHONY: dev db seed test e2e worker advance reset

# Start Postgres + the app in Docker (migrations run on start).
dev:
	docker compose up

# Only the database, for running the app on the host with `npm run dev`.
db:
	docker compose up -d db

reset:
	npx prisma migrate reset --force --skip-seed

seed:
	npm run seed

worker:
	npm run worker

advance:
	npm run demo:advance-day

test:
	npm test

e2e:
	npm run test:e2e
