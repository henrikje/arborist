class Arb < Formula
  desc "Workspace manager for multi-repo projects built on Git worktrees"
  homepage "https://github.com/henrikje/arborist"
  version "VERSION"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-darwin-arm64.tar.gz"
      sha256 "SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-darwin-x64.tar.gz"
      sha256 "SHA256_DARWIN_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-linux-arm64.tar.gz"
      sha256 "SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/henrikje/arborist/releases/download/vVERSION/arb-VERSION-linux-x64.tar.gz"
      sha256 "SHA256_LINUX_X64"
    end
  end

  def install
    bin.install "arb"
    (share/"arb").install "shell/arb.zsh"
    (share/"arb/skill").install "skill/SKILL.md"
    (share/"arb/skill/references").install "skill/references/commands.md"
  end

  def post_install
    claude_dir = Pathname.new(Dir.home)/".claude"
    if claude_dir.directory?
      skill_dir = claude_dir/"skills/arb/references"
      skill_dir.mkpath
      cp share/"arb/skill/SKILL.md", claude_dir/"skills/arb/SKILL.md"
      cp share/"arb/skill/references/commands.md", skill_dir/"commands.md"
    end
  end

  def caveats
    shell_line = "source \"#{share}/arb/arb.zsh\""
    <<~EOS
      To enable the shell function (required for arb cd), add to your shell profile:

          #{shell_line}

      For zsh, add it to ~/.zshrc. For bash, add it to ~/.bashrc.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/arb --version")
  end
end
