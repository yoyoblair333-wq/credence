"""Pin the GenVM SDK release for direct mode so the suite runs against the v0.2
runner this contract's Depends header targets (not whatever GenVM shipped last)."""

import os
import pytest

GENVM_VERSION = os.environ.get("GENVM_VERSION") or "v0.2.16"


@pytest.fixture
def direct_deploy(direct_deploy):
    def _deploy(contract_path, *args, sdk_version=None, **kwargs):
        return direct_deploy(contract_path, *args, sdk_version=sdk_version or GENVM_VERSION, **kwargs)

    return _deploy
