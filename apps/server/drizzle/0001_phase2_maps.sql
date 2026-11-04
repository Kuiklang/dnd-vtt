CREATE TYPE "public"."asset_kind" AS ENUM('map', 'token', 'portrait', 'avatar', 'cover', 'handout', 'other');--> statement-breakpoint
CREATE TYPE "public"."fog_mode" AS ENUM('reveal', 'hide');--> statement-breakpoint
CREATE TYPE "public"."token_layer" AS ENUM('map', 'objects', 'tokens', 'dm');--> statement-breakpoint
CREATE TYPE "public"."token_shape" AS ENUM('circle', 'square');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"campaign_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fog_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "fog_ops_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mode" "fog_mode" NOT NULL,
	"shape" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"background_asset_id" uuid,
	"background_color" text DEFAULT '#1a1714' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"grid" jsonb NOT NULL,
	"fog_enabled" boolean DEFAULT false NOT NULL,
	"dm_notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"character_id" uuid,
	"name" text NOT NULL,
	"image_asset_id" uuid,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"size" real DEFAULT 1 NOT NULL,
	"rotation" real DEFAULT 0 NOT NULL,
	"layer" "token_layer" DEFAULT 'tokens' NOT NULL,
	"shape" "token_shape" DEFAULT 'circle' NOT NULL,
	"color" text DEFAULT '#7d241c' NOT NULL,
	"border_color" text DEFAULT '#d9b14f' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"show_name" boolean DEFAULT true NOT NULL,
	"owner_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "active_scene_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fog_ops" ADD CONSTRAINT "fog_ops_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fog_ops" ADD CONSTRAINT "fog_ops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_background_asset_id_assets_id_fk" FOREIGN KEY ("background_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_image_asset_id_assets_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "assets_campaign_idx" ON "assets" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "fog_ops_scene_seq_idx" ON "fog_ops" USING btree ("scene_id","seq");--> statement-breakpoint
CREATE INDEX "scenes_campaign_idx" ON "scenes" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "tokens_scene_idx" ON "tokens" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "tokens_campaign_idx" ON "tokens" USING btree ("campaign_id");