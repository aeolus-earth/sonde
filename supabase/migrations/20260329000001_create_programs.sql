-- Programs: namespace/scoping for all records
-- e.g. 'weather-intervention', 'energy-trading', 'shared'

CREATE TABLE programs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the initial programs
INSERT INTO programs (id, name, description) VALUES
    ('weather-intervention', 'Weather Intervention', 'Atmospheric science research — NWP simulations, cloud seeding, boundary layer experiments'),
    ('energy-trading', 'Energy Trading', 'Weather-informed market signals, demand forecasting, renewable generation prediction'),
    ('nwp-development', 'NWP Development', 'Breeze.jl development, model validation, numerical methods'),
    ('shared', 'Shared', 'Cross-cutting knowledge — data source docs, methods, tools');
