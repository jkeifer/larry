{
  description = "larry — a trustworthy JSON viewer extension (jq querying via one pinned, eval-free dependency), with declarative force-install for NixOS and nix-darwin.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # Pure-JS, eval-free jq implementation (MIT). Source only — pinned by
    # flake.lock (commit + narHash); bump with `nix flake update jqjs`.
    jqjs = {
      url = "github:mwh/jqjs";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, jqjs }:
    let
      # Options shared by the NixOS and darwin modules. `extensionId` is the
      # 32-char ID the Chrome Web Store assigns once you publish (strategy A).
      commonOptions = lib: {
        enable = lib.mkEnableOption "force-install larry, the trustworthy JSON viewer";
        extensionId = lib.mkOption {
          type = lib.types.strMatching "[a-p]{32}";
          example = "abcdefghijklmnopabcdefghijklmnop";
          description = "Web Store extension ID, assigned after you first publish.";
        };
        updateUrl = lib.mkOption {
          type = lib.types.str;
          default = "https://clients2.google.com/service/update2/crx";
          description = "Update manifest URL. Default is the Chrome Web Store.";
        };
      };

      # The ExtensionSettings policy body, shared by every platform.
      policyAttrs = cfg: {
        ExtensionSettings.${cfg.extensionId} = {
          installation_mode = "force_installed";
          update_url = cfg.updateUrl;
        };
      };
    in
    {
      # ---- Declarative force-install: NixOS -------------------------------
      nixosModules.default = { config, lib, ... }:
        let cfg = config.programs.jsonViewer;
        in {
          options.programs.jsonViewer = commonOptions lib;
          config = lib.mkIf cfg.enable {
            # Chromium and Google Chrome read managed policy from these dirs.
            environment.etc = {
              "chromium/policies/managed/json-viewer.json".text =
                builtins.toJSON (policyAttrs cfg);
              "opt/chrome/policies/managed/json-viewer.json".text =
                builtins.toJSON (policyAttrs cfg);
            };
          };
        };

      # ---- Declarative force-install: nix-darwin --------------------------
      # NOTE: This writes the com.google.Chrome managed-preferences domain via
      # `defaults`. Verify at chrome://policy that the extension shows up. If it
      # doesn't, macOS is only honoring policy delivered as a configuration
      # profile (.mobileconfig) — see README for that fallback.
      darwinModules.default = { config, lib, ... }:
        let cfg = config.programs.jsonViewer;
        in {
          options.programs.jsonViewer = commonOptions lib;
          config = lib.mkIf cfg.enable {
            system.defaults.CustomSystemPreferences."com.google.Chrome" =
              policyAttrs cfg;
          };
        };
    }
    // flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        version =
          let env = builtins.getEnv "LARRY_VERSION";
          in if env != "" then env else "1.0.${toString (self.revCount or 0)}";
      in {
        # ---- Build the loadable / uploadable extension ------------------
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "json-viewer-extension";
          inherit version;
          src = ./.;
          nativeBuildInputs = [ pkgs.typescript pkgs.esbuild pkgs.zip pkgs.librsvg ];
          buildPhase = ''
            runHook preBuild
            mkdir -p dist
            esbuild src/content.ts --bundle --format=iife --platform=browser \
              --target=es2020 --outfile=dist/content.js
            cp src/content.css src/manifest.json dist/
            substituteInPlace dist/manifest.json \
              --replace-quiet '"version": "0.0.0"' '"version": "${version}"'
            # jqjs ships as an ES module, but a content script can't be one, so
            # strip its `export` lines and expose the API as a global instead.
            grep -v '^export ' ${jqjs}/jq.js > dist/jqjs.js
            printf '\nglobalThis.jqjs = { compile, prettyPrint, compileNode, formats };\n' >> dist/jqjs.js
            for s in 16 32 48 128; do
              rsvg-convert -w $s -h $s src/icon.svg -o dist/icon-$s.png
            done
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out/extension
            cp dist/jqjs.js dist/content.js dist/content.css dist/manifest.json $out/extension/
            cp dist/icon-16.png dist/icon-32.png dist/icon-48.png dist/icon-128.png $out/extension/
            ( cd $out/extension && zip -qr "$out/json-viewer.zip" . )
            runHook postInstall
          '';
          meta.description = "Loadable extension dir ($out/extension) and store upload zip ($out/json-viewer.zip).";
        };

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.typescript pkgs.nodejs pkgs.librsvg ];
          shellHook = ''echo "tsc -p tsconfig.json --watch  # dev build into ./dist"'';
        };
      });
}
