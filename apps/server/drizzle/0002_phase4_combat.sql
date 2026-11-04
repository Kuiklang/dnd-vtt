CREATE TYPE "public"."combat_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."hp_visibility" AS ENUM('everyone', 'owners', 'gm');--> statement-breakpoint
CREATE TABLE "combatants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"combat_id" uuid NOT NULL,
	"token_id" uuid,
	"character_id" uuid,
	"name" text NOT NULL,
	"initiative" integer,
	"initiative_bonus" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"defeated" boolean DEFAULT false NOT NULL,
	"actions" jsonb NOT NULL,
	"owner_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "combats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"scene_id" uuid,
	"status" "combat_status" DEFAULT 'active' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"turn_index" integer DEFAULT 0 NOT NULL,
	"active_combatant_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "hp_visibility" "hp_visibility" DEFAULT 'gm' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "stats" jsonb;--> statement-breakpoint
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_combat_id_combats_id_fk" FOREIGN KEY ("combat_id") REFERENCES "public"."combats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combats" ADD CONSTRAINT "combats_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combats" ADD CONSTRAINT "combats_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combats" ADD CONSTRAINT "combats_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "combatants_combat_idx" ON "combatants" USING btree ("combat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "combatants_token_unique_idx" ON "combatants" USING btree ("combat_id","token_id") WHERE "combatants"."token_id" is not null;--> statement-breakpoint
CREATE INDEX "combats_campaign_idx" ON "combats" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "combats_one_active_idx" ON "combats" USING btree ("campaign_id") WHERE "combats"."status" = 'active';--> statement-breakpoint
CREATE INDEX "tokens_character_idx" ON "tokens" USING btree ("character_id");