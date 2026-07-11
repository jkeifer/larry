{
  description = "Trustworthy JSON Viewer — a dependency-free JSON viewer extension, with declarative force-install for NixOS and nix-darwin.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      # Options shared by the NixOS and darwin modules. `extensionId` is the
      # 32-char ID the Chrome Web Store assigns once you publish (strategy A).
      commonOptions = lib: {
        enable = lib.mkEnableOption "force-install the Trustworthy JSON Viewer";
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
      let pkgs = nixpkgs.legacyPackages.${system};
      in {
        # ---- Build the loadable / uploadable extension ------------------
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "json-viewer-extension";
          version = "1.0.0";
          src = ./.;
          nativeBuildInputs = [ pkgs.typescript pkgs.zip ];
          buildPhase = ''
            runHook preBuild
            tsc -p tsconfig.json
            cp src/content.css src/manifest.json dist/
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out/extension
            cp dist/content.js dist/content.css dist/manifest.json $out/extension/
            ( cd $out/extension && zip -qr "$out/json-viewer.zip" . )
            runHook postInstall
          '';
          meta.description = "Loadable extension dir ($out/extension) and store upload zip ($out/json-viewer.zip).";
        };

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.typescript pkgs.nodejs ];
          shellHook = ''echo "tsc -p tsconfig.json --watch  # dev build into ./dist"'';
        };
      });
}
